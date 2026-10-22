import prisma from '../../../config/db';
import { Prisma, ChannelType, MemberRole, Role, ChatAttachmentKind } from '@prisma/client';
import {
    emitToChannel,
    emitToUser,
    addUserToChannelRoom,
    removeUserFromChannelRoom,
    getBatchPresence as presenceLookup,
} from '../../../realtime/socket';
import { sendNotification } from './notificationService';
import { PARENT_CONTACTABLE_ROLES } from '../../../utils/roleHierarchy';
import { classifyChatMimeType } from '../../../utils/fileUpload';

// ---------- Types ----------

export interface PostMessageInput {
    content: string;
    parentMessageId?: number | null;
    mentionUserIds?: number[];
    attachments?: Array<{
        file_url: string;
        file_name: string;
        mime_type?: string;
        size_bytes?: number;
        kind?: 'IMAGE' | 'AUDIO' | 'VIDEO' | 'FILE';
        duration_secs?: number;
        width?: number;
        height?: number;
    }>;
}

export interface CreateCustomChannelInput {
    name: string;
    description?: string;
    memberIds: number[];
    isPrivate?: boolean;
}

// ---------- Helpers ----------

async function requireMembership(channelId: number, userId: number) {
    const member = await prisma.chatChannelMember.findUnique({
        where: { channel_id_user_id: { channel_id: channelId, user_id: userId } },
    });
    if (!member) {
        const err: any = new Error('You are not a member of this channel');
        err.statusCode = 403;
        throw err;
    }
    return member;
}

async function getUserTopRoles(userId: number): Promise<Role[]> {
    const roles = await prisma.userRole.findMany({
        where: { user_id: userId },
        select: { role: true },
    });
    return [...new Set(roles.map(r => r.role))];
}

function isParent(roles: Role[]): boolean {
    return roles.includes('PARENT');
}

const MESSAGE_INCLUDE = {
    sender: { select: { id: true, name: true, matricule: true } },
    attachments: true,
    reactions: {
        include: { user: { select: { id: true, name: true } } },
    },
    mentions: {
        include: { user: { select: { id: true, name: true, matricule: true } } },
    },
    parent_message: {
        select: {
            id: true,
            content: true,
            sender_id: true,
            deleted_at: true,
            created_at: true,
            sender: { select: { id: true, name: true } },
            attachments: {
                select: { id: true, kind: true, file_name: true },
                take: 1,
            },
        },
    },
} as const;

// ---------- Channel listings ----------

export async function listMyChannels(userId: number) {
    const memberships = await prisma.chatChannelMember.findMany({
        where: { user_id: userId },
        include: {
            channel: {
                include: {
                    subject: { select: { id: true, name: true } },
                    members: {
                        select: {
                            user: { select: { id: true, name: true } },
                            role: true,
                        },
                    },
                },
            },
        },
        orderBy: { channel: { updated_at: 'desc' } },
    });

    // For each channel, get last message + unread count
    const result = await Promise.all(
        memberships.map(async m => {
            const [lastMessage, unreadCount] = await Promise.all([
                prisma.chatMessage.findFirst({
                    where: { channel_id: m.channel_id, deleted_at: null },
                    orderBy: { created_at: 'desc' },
                    include: { sender: { select: { id: true, name: true } } },
                }),
                prisma.chatMessage.count({
                    where: {
                        channel_id: m.channel_id,
                        deleted_at: null,
                        created_at: m.last_read_at ? { gt: m.last_read_at } : undefined,
                        sender_id: { not: userId },
                    },
                }),
            ]);

            return {
                id: m.channel.id,
                name: m.channel.name,
                description: m.channel.description,
                type: m.channel.type,
                department: m.channel.department,
                subject: m.channel.subject,
                is_private: m.channel.is_private,
                is_system: m.channel.is_system,
                my_role: m.role,
                muted: m.muted,
                last_read_at: m.last_read_at,
                unread_count: unreadCount,
                last_message: lastMessage,
                member_count: m.channel.members.length,
                updated_at: m.channel.updated_at,
            };
        }),
    );

    return result;
}

export async function getChannel(channelId: number, userId: number) {
    await requireMembership(channelId, userId);
    const channel = await prisma.chatChannel.findUnique({
        where: { id: channelId },
        include: {
            subject: { select: { id: true, name: true } },
            members: {
                include: {
                    user: {
                        select: {
                            id: true,
                            name: true,
                            matricule: true,
                            photo: true,
                            last_seen_at: true,
                            user_roles: { select: { role: true } },
                        },
                    },
                },
            },
        },
    });
    if (!channel) return null;

    // Enrich each member with presence + expose last_read_at at the top level
    // so the client can compute per-message "seen by" without extra plumbing.
    const memberIds = channel.members.map((m) => m.user_id);
    const presenceMap = await presenceLookup(memberIds);

    // my_role: the caller's membership role. The channel list already sends
    // it; the detail did not, so the client defaulted everyone to MEMBER and
    // even a channel's creator (ADMIN) never saw "Add members".
    const me = channel.members.find((m) => m.user_id === userId);
    return {
        ...channel,
        my_role: me?.role ?? null,
        member_count: channel.members.length,
        members: channel.members.map((m) => ({
            id: m.id,
            channel_id: m.channel_id,
            user_id: m.user_id,
            role: m.role,
            joined_at: m.joined_at,
            last_read_at: m.last_read_at,
            muted: m.muted,
            user: m.user,
            presence: presenceMap[m.user_id] ?? { online: false, last_seen_at: m.user.last_seen_at ?? null },
        })),
    };
}

// ---------- Messages ----------

export async function listMessages(
    channelId: number,
    userId: number,
    opts: { before?: string; limit?: number; threadOf?: number } = {},
) {
    await requireMembership(channelId, userId);
    const limit = Math.min(opts.limit && opts.limit > 0 ? opts.limit : 50, 200);

    const where: Prisma.ChatMessageWhereInput = {
        channel_id: channelId,
        deleted_at: null,
        // When thread_of is provided, return only replies to that message.
        // Otherwise return the full channel scroll (including replies inline, WhatsApp-style).
        ...(opts.threadOf ? { parent_message_id: opts.threadOf } : {}),
        ...(opts.before && { created_at: { lt: new Date(opts.before) } }),
    };

    const messages = await prisma.chatMessage.findMany({
        where,
        include: {
            ...MESSAGE_INCLUDE,
            _count: { select: { replies: true } },
        },
        orderBy: { created_at: 'desc' },
        take: limit,
    });

    // Derive per-message "seen by" using each channel member's last_read_at.
    // A member has seen message M iff `member.last_read_at >= message.created_at`.
    const otherMembers = await prisma.chatChannelMember.findMany({
        where: { channel_id: channelId, user_id: { not: userId } },
        select: { user_id: true, last_read_at: true },
    });
    const enriched = messages.map((m) => {
        const seenBy = otherMembers
            .filter((mm) => mm.last_read_at && mm.last_read_at.getTime() >= m.created_at.getTime())
            .map((mm) => mm.user_id);
        return {
            ...m,
            seen_by_user_ids: seenBy,
            seen_count: seenBy.length,
        };
    });

    return enriched.reverse();
}

export async function postMessage(channelId: number, senderId: number, input: PostMessageInput) {
    const membership = await requireMembership(channelId, senderId);
    const channel = await prisma.chatChannel.findUnique({ where: { id: channelId } });
    if (!channel) {
        const err: any = new Error('Channel not found');
        err.statusCode = 404;
        throw err;
    }

    const senderRoles = await getUserTopRoles(senderId);
    if (isParent(senderRoles) && channel.type !== 'DIRECT') {
        const err: any = new Error('Parents can only post in direct messages');
        err.statusCode = 403;
        throw err;
    }

    if (!input.content?.trim() && !(input.attachments && input.attachments.length)) {
        const err: any = new Error('Message must have content or attachments');
        err.statusCode = 400;
        throw err;
    }

    if (input.parentMessageId) {
        const parent = await prisma.chatMessage.findUnique({
            where: { id: input.parentMessageId },
            select: { channel_id: true },
        });
        if (!parent || parent.channel_id !== channelId) {
            const err: any = new Error('Parent message not found in this channel');
            err.statusCode = 400;
            throw err;
        }
    }

    // Validate mentions: each mentioned user must be a member of this channel.
    // Silently drop the sender's own ID if included, and dedupe.
    let mentionUserIds: number[] = [];
    if (input.mentionUserIds && input.mentionUserIds.length) {
        const requested = [...new Set(input.mentionUserIds.filter((id) => id && id !== senderId))];
        if (requested.length) {
            const validMembers = await prisma.chatChannelMember.findMany({
                where: { channel_id: channelId, user_id: { in: requested } },
                select: { user_id: true },
            });
            mentionUserIds = validMembers.map((v) => v.user_id);
        }
    }

    const attachmentsPayload = (input.attachments || []).map((a) => ({
        file_url: a.file_url,
        file_name: a.file_name,
        mime_type: a.mime_type ?? null,
        size_bytes: a.size_bytes ?? null,
        kind: (a.kind as ChatAttachmentKind) || (classifyChatMimeType(a.mime_type) as ChatAttachmentKind),
        duration_secs: a.duration_secs ?? null,
        width: a.width ?? null,
        height: a.height ?? null,
    }));

    const message = await prisma.chatMessage.create({
        data: {
            channel_id: channelId,
            sender_id: senderId,
            content: input.content?.trim() || '',
            parent_message_id: input.parentMessageId ?? null,
            attachments: attachmentsPayload.length ? { create: attachmentsPayload } : undefined,
            mentions: mentionUserIds.length
                ? { create: mentionUserIds.map((uid) => ({ user_id: uid })) }
                : undefined,
        },
        include: MESSAGE_INCLUDE,
    });

    // Touch channel updated_at for sorting
    await prisma.chatChannel.update({ where: { id: channelId }, data: { updated_at: new Date() } });

    // Broadcast over WS
    emitToChannel(channelId, 'message.new', message);

    // Dedicated mention event — targeted per user so clients can badge/toast distinctly
    // even when the mentioned user isn't currently viewing the channel.
    if (mentionUserIds.length) {
        for (const uid of mentionUserIds) {
            emitToUser(uid, 'chat.mention.new', {
                channel_id: channelId,
                channel_name: channel.name,
                message_id: message.id,
                sender: { id: message.sender.id, name: message.sender.name },
                preview: message.content.slice(0, 120),
                created_at: message.created_at,
            });
        }
    }

    // Offline push: notify all members except sender via MobileNotification.
    // Mentioned users get a clearly distinguished message.
    prisma.chatChannelMember
        .findMany({ where: { channel_id: channelId, user_id: { not: senderId }, muted: false } })
        .then(async recipients => {
            const senderName = message.sender.name;
            const preview = message.content.slice(0, 80);
            const mentionSet = new Set(mentionUserIds);
            for (const r of recipients) {
                try {
                    const mentioned = mentionSet.has(r.user_id);
                    await sendNotification({
                        user_id: r.user_id,
                        title: mentioned
                            ? `@${senderName} mentioned you in #${channel.name}`
                            : `#${channel.name}`,
                        message: mentioned
                            ? `@ ${senderName} mentioned you in #${channel.name}: ${preview}`
                            : `#${channel.name}: ${senderName}: ${preview}`,
                        // Mentions surface as a popup; regular channel activity stays NORMAL
                        // so busy channels don't spam every member with modals.
                        priority: mentioned ? 'HIGH' : 'NORMAL',
                        entity_type: 'ChatMessage',
                        entity_id: message.id,
                        action_url: `/chat/${channelId}`,
                    });
                } catch (e) {
                    // notification failure should not break posting
                }
            }
        })
        .catch(() => { /* swallow */ });

    // Auto-mark sender's own message as read
    await prisma.chatChannelMember.update({
        where: { id: membership.id },
        data: { last_read_at: message.created_at },
    });

    return message;
}

export async function editMessage(messageId: number, userId: number, content: string) {
    const msg = await prisma.chatMessage.findUnique({ where: { id: messageId } });
    if (!msg || msg.deleted_at) {
        const err: any = new Error('Message not found');
        err.statusCode = 404;
        throw err;
    }
    if (msg.sender_id !== userId) {
        const err: any = new Error('Only the sender can edit this message');
        err.statusCode = 403;
        throw err;
    }
    if (!content?.trim()) {
        const err: any = new Error('Content required');
        err.statusCode = 400;
        throw err;
    }

    const updated = await prisma.chatMessage.update({
        where: { id: messageId },
        data: { content: content.trim(), edited_at: new Date() },
        include: MESSAGE_INCLUDE,
    });

    emitToChannel(msg.channel_id, 'message.updated', updated);
    return updated;
}

export async function deleteMessage(messageId: number, userId: number) {
    const msg = await prisma.chatMessage.findUnique({ where: { id: messageId } });
    if (!msg || msg.deleted_at) {
        const err: any = new Error('Message not found');
        err.statusCode = 404;
        throw err;
    }

    let allowed = msg.sender_id === userId;
    if (!allowed) {
        const membership = await prisma.chatChannelMember.findUnique({
            where: { channel_id_user_id: { channel_id: msg.channel_id, user_id: userId } },
        });
        allowed = membership?.role === 'ADMIN';
    }
    if (!allowed) {
        const err: any = new Error('Not authorized to delete this message');
        err.statusCode = 403;
        throw err;
    }

    const updated = await prisma.chatMessage.update({
        where: { id: messageId },
        data: { deleted_at: new Date(), content: '' },
    });

    emitToChannel(msg.channel_id, 'message.deleted', { id: messageId, channel_id: msg.channel_id });
    return updated;
}

// ---------- Reactions ----------

export async function addReaction(messageId: number, userId: number, emoji: string) {
    const msg = await prisma.chatMessage.findUnique({ where: { id: messageId } });
    if (!msg || msg.deleted_at) {
        const err: any = new Error('Message not found');
        err.statusCode = 404;
        throw err;
    }
    await requireMembership(msg.channel_id, userId);
    if (!emoji?.trim()) {
        const err: any = new Error('emoji required');
        err.statusCode = 400;
        throw err;
    }

    const reaction = await prisma.chatMessageReaction.upsert({
        where: { message_id_user_id_emoji: { message_id: messageId, user_id: userId, emoji } },
        create: { message_id: messageId, user_id: userId, emoji },
        update: {},
        include: { user: { select: { id: true, name: true } } },
    });

    emitToChannel(msg.channel_id, 'reaction.added', {
        message_id: messageId,
        channel_id: msg.channel_id,
        reaction,
    });
    return reaction;
}

export async function removeReaction(messageId: number, userId: number, emoji: string) {
    const msg = await prisma.chatMessage.findUnique({ where: { id: messageId } });
    if (!msg) {
        const err: any = new Error('Message not found');
        err.statusCode = 404;
        throw err;
    }

    await prisma.chatMessageReaction.deleteMany({
        where: { message_id: messageId, user_id: userId, emoji },
    });

    emitToChannel(msg.channel_id, 'reaction.removed', {
        message_id: messageId,
        channel_id: msg.channel_id,
        user_id: userId,
        emoji,
    });
    return { success: true };
}

// ---------- Read state ----------

export async function markRead(channelId: number, userId: number, upToMessageId?: number) {
    const membership = await requireMembership(channelId, userId);
    let readAt = new Date();

    if (upToMessageId) {
        const msg = await prisma.chatMessage.findUnique({ where: { id: upToMessageId } });
        if (msg && msg.channel_id === channelId) {
            readAt = msg.created_at;
        }
    }

    await prisma.chatChannelMember.update({
        where: { id: membership.id },
        data: { last_read_at: readAt },
    });

    emitToChannel(channelId, 'read.updated', { channel_id: channelId, user_id: userId, last_read_at: readAt });
    return { success: true, last_read_at: readAt };
}

// ---------- Channel management ----------

export async function createCustomChannel(actorId: number, input: CreateCustomChannelInput) {
    if (!input.name?.trim()) {
        const err: any = new Error('name required');
        err.statusCode = 400;
        throw err;
    }
    const actorRoles = await getUserTopRoles(actorId);
    if (isParent(actorRoles)) {
        const err: any = new Error('Parents cannot create custom channels');
        err.statusCode = 403;
        throw err;
    }

    const memberIdsSet = new Set<number>([actorId, ...(input.memberIds || [])]);
    const channel = await prisma.chatChannel.create({
        data: {
            name: input.name.trim(),
            description: input.description?.trim() || null,
            type: 'CUSTOM',
            is_private: !!input.isPrivate,
            created_by_id: actorId,
            members: {
                create: [...memberIdsSet].map(uid => ({
                    user_id: uid,
                    role: uid === actorId ? MemberRole.ADMIN : MemberRole.MEMBER,
                })),
            },
        },
        include: { members: true },
    });

    for (const m of channel.members) {
        addUserToChannelRoom(m.user_id, channel.id);
        emitToUser(m.user_id, 'channel.created', channel);
    }
    return channel;
}

export async function addMember(channelId: number, actorId: number, targetUserId: number) {
    const actorMembership = await requireMembership(channelId, actorId);
    if (actorMembership.role !== 'ADMIN') {
        const err: any = new Error('Only channel admins can add members');
        err.statusCode = 403;
        throw err;
    }
    const channel = await prisma.chatChannel.findUnique({ where: { id: channelId } });
    if (!channel) {
        const err: any = new Error('Channel not found');
        err.statusCode = 404;
        throw err;
    }
    if (channel.is_system) {
        const err: any = new Error('Cannot manually manage members of system channels');
        err.statusCode = 400;
        throw err;
    }

    const member = await prisma.chatChannelMember.upsert({
        where: { channel_id_user_id: { channel_id: channelId, user_id: targetUserId } },
        create: { channel_id: channelId, user_id: targetUserId, role: MemberRole.MEMBER },
        update: {},
        include: { user: { select: { id: true, name: true } } },
    });

    addUserToChannelRoom(targetUserId, channelId);
    emitToChannel(channelId, 'member.joined', { channel_id: channelId, member });
    emitToUser(targetUserId, 'channel.created', channel);
    return member;
}

export async function removeMember(channelId: number, actorId: number, targetUserId: number) {
    const actorMembership = await requireMembership(channelId, actorId);
    const isSelf = actorId === targetUserId;
    if (!isSelf && actorMembership.role !== 'ADMIN') {
        const err: any = new Error('Only channel admins can remove other members');
        err.statusCode = 403;
        throw err;
    }
    const channel = await prisma.chatChannel.findUnique({ where: { id: channelId } });
    if (channel?.is_system) {
        const err: any = new Error('Cannot leave system channels');
        err.statusCode = 400;
        throw err;
    }

    await prisma.chatChannelMember.deleteMany({
        where: { channel_id: channelId, user_id: targetUserId },
    });

    removeUserFromChannelRoom(targetUserId, channelId);
    emitToChannel(channelId, 'member.left', { channel_id: channelId, user_id: targetUserId });
    return { success: true };
}

// ---------- Direct Messages ----------

export async function openDirectMessage(actorId: number, otherUserIds: number[]) {
    const memberSet = new Set<number>([actorId, ...otherUserIds.filter(id => id !== actorId)]);
    if (memberSet.size < 2) {
        const err: any = new Error('DM needs at least two participants');
        err.statusCode = 400;
        throw err;
    }

    const actorRoles = await getUserTopRoles(actorId);
    const actorIsParent = isParent(actorRoles);

    // If parent, enforce contactable roles for every counterpart
    if (actorIsParent) {
        for (const uid of memberSet) {
            if (uid === actorId) continue;
            const counterpartRoles = await getUserTopRoles(uid);
            const ok = counterpartRoles.some(r => (PARENT_CONTACTABLE_ROLES as string[]).includes(r));
            if (!ok) {
                const err: any = new Error(
                    `You are not allowed to message users with roles: ${counterpartRoles.join(', ')}`,
                );
                err.statusCode = 403;
                throw err;
            }
        }
    }

    // Find existing DM with exactly this member set
    const candidates = await prisma.chatChannel.findMany({
        where: { type: 'DIRECT', members: { every: { user_id: { in: [...memberSet] } } } },
        include: { members: { select: { user_id: true } } },
    });
    const match = candidates.find(
        c => c.members.length === memberSet.size &&
             c.members.every(m => memberSet.has(m.user_id)),
    );
    if (match) return match;

    // Otherwise create it
    const users = await prisma.user.findMany({
        where: { id: { in: [...memberSet] } },
        select: { id: true, name: true },
    });
    const nameHint = users.map(u => u.name).join(', ').slice(0, 100);

    const channel = await prisma.chatChannel.create({
        data: {
            name: nameHint,
            type: 'DIRECT',
            is_private: true,
            is_system: false,
            created_by_id: actorId,
            members: {
                create: [...memberSet].map(uid => ({
                    user_id: uid,
                    role: MemberRole.MEMBER,
                })),
            },
        },
        include: { members: true },
    });

    for (const m of channel.members) {
        addUserToChannelRoom(m.user_id, channel.id);
        emitToUser(m.user_id, 'channel.created', channel);
    }
    return channel;
}

// ---------- Contact search ----------

const CONTACT_SELECT = {
    id: true,
    name: true,
    matricule: true,
    photo: true,
    email: true,
    phone: true,
    last_seen_at: true,
    user_roles: { select: { role: true } },
} as const;

/**
 * Universal in-app contact search. PARENT callers are restricted to users whose
 * role set intersects `PARENT_CONTACTABLE_ROLES` (matches the server-side DM
 * enforcement so the UI never surfaces contacts that would be rejected on send).
 * All other roles can find any active user with at least one non-PARENT role.
 *
 * Response includes a `presence` block (online + last_seen_at) and — when a
 * 1:1 DM channel between the caller and the contact already exists — its
 * `dm_channel_id`, so the frontend can jump straight in.
 */
export async function searchContacts(
    callerId: number,
    opts: { search?: string; limit?: number } = {},
) {
    const limit = Math.min(opts.limit && opts.limit > 0 ? opts.limit : 20, 50);
    const q = opts.search?.trim();

    const callerRoles = await getUserTopRoles(callerId);
    const callerIsParent = isParent(callerRoles);

    const where: Prisma.UserWhereInput = {
        id: { not: callerId },
        status: 'ACTIVE',
        ...(q
            ? {
                  OR: [
                      { name: { contains: q, mode: 'insensitive' } },
                      { matricule: { contains: q, mode: 'insensitive' } },
                      { email: { contains: q, mode: 'insensitive' } },
                  ],
              }
            : {}),
    };

    if (callerIsParent) {
        where.user_roles = {
            some: { role: { in: PARENT_CONTACTABLE_ROLES as any } },
        };
    } else {
        // Non-parent callers: allow any user with at least one non-PARENT role.
        where.user_roles = { some: { role: { not: 'PARENT' as any } } };
    }

    const users = await prisma.user.findMany({
        where,
        select: CONTACT_SELECT,
        orderBy: [{ name: 'asc' }],
        take: limit,
    });

    // Existing 1:1 DM channel between caller and each user (if any)
    const userIds = users.map((u) => u.id);
    const dmMap = new Map<number, number>();
    if (userIds.length > 0) {
        const dms = await prisma.chatChannel.findMany({
            where: {
                type: 'DIRECT',
                members: { every: { user_id: { in: [callerId, ...userIds] } } },
            },
            include: { members: { select: { user_id: true } } },
        });
        for (const c of dms) {
            if (c.members.length !== 2) continue;
            const other = c.members.find((m) => m.user_id !== callerId)?.user_id;
            if (other && userIds.includes(other)) {
                dmMap.set(other, c.id);
            }
        }
    }

    const presenceMap = await presenceLookup(userIds);

    return users.map((u) => ({
        ...u,
        roles: u.user_roles.map((r) => r.role),
        dm_channel_id: dmMap.get(u.id) ?? null,
        presence: presenceMap[u.id] ?? { online: false, last_seen_at: u.last_seen_at ?? null },
    }));
}

// ---------- Presence ----------

/**
 * Return online + last_seen_at for a batch of userIds. Combines the in-memory
 * socket presence store (authoritative for "online") with the persisted
 * `User.last_seen_at` fallback (populated on disconnect).
 */
export async function getBatchPresence(userIds: number[]) {
    if (userIds.length === 0) return {};
    const memory = await presenceLookup(userIds);
    const rows = await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, last_seen_at: true },
    });
    const result: Record<number, { online: boolean; last_seen_at: Date | null }> = {};
    for (const r of rows) {
        const mem = memory[r.id];
        result[r.id] = {
            online: mem?.online ?? false,
            last_seen_at: mem?.online ? null : (mem?.last_seen_at ?? r.last_seen_at ?? null),
        };
    }
    return result;
}
