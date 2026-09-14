import prisma from '../../../config/db';
import { MessageStatus } from '@prisma/client';
import { getCurrentAcademicYear } from '../../../utils/academicYear';
import { sendNotification } from './notificationService';
import { notifyIfReceiverIsParent } from './parentService';

export interface CreateMessageData {
    senderId: number;
    receiverId: number;
    subject: string;
    content: string;
    priority?: 'LOW' | 'MEDIUM' | 'HIGH';
    attachments?: string[];
}

export interface MessageFilters {
    status?: MessageStatus;
    priority?: 'LOW' | 'MEDIUM' | 'HIGH';
    dateFrom?: string;
    dateTo?: string;
    search?: string;
}

export interface ConversationParticipant {
    id: number;
    name: string;
    role: string;
    matricule: string;
    unreadCount: number;
    lastMessage?: {
        content: string;
        timestamp: Date;
        isFromMe: boolean;
    };
}

// Add simplified message categories
export enum MessageCategory {
    ACADEMIC = 'ACADEMIC',
    FINANCIAL = 'FINANCIAL',
    DISCIPLINARY = 'DISCIPLINARY',
    GENERAL = 'GENERAL'
}

// Simplified message interface
export interface SimpleMessage {
    id: number;
    from: string;
    to: string;
    subject: string;
    content: string;
    category: MessageCategory;
    date: string;
    isRead: boolean;
    senderRole: string;
    receiverRole: string;
}

// Send a direct message
export async function sendDirectMessage(data: CreateMessageData) {
    try {
        // Validate users exist
        const [sender, receiver] = await Promise.all([
            prisma.user.findUnique({ where: { id: data.senderId } }),
            prisma.user.findUnique({ where: { id: data.receiverId } })
        ]);

        if (!sender || !receiver) {
            throw new Error('Sender or receiver not found');
        }

        // Create message
        const message = await prisma.message.create({
            data: {
                sender_id: data.senderId,
                receiver_id: data.receiverId,
                subject: data.subject,
                content: data.content,
                status: MessageStatus.SENT
            },
            include: {
                sender: { select: { id: true, name: true, matricule: true } },
                receiver: { select: { id: true, name: true, matricule: true } }
            }
        });

        // Send in-app notification to recipient (popup — direct messages are urgent).
        const notificationMessage = `New message from ${sender.name}: ${data.subject}`;

        await sendNotification({
            user_id: data.receiverId,
            title: `New message from ${sender.name}`,
            message: notificationMessage,
            sender_id: data.senderId,
            category: 'GENERAL',
            priority: 'HIGH',
            entity_type: 'Message',
            entity_id: message.id,
            action_url: `/messages/${message.id}`,
        });

        // Parent inbox integration: this generic DM path is used by both
        // staff-to-staff and staff-to-parent conversations. We can't tell here
        // whether it's a "staff replies to parent" case without a role lookup,
        // so the helper below role-checks the receiver and only fires the
        // parent-portal notification when the receiver actually holds PARENT.
        await notifyIfReceiverIsParent(data.receiverId, data.senderId, message.id, data.subject, sender.name);

        console.log(`✅ Message sent and notification delivered to ${receiver.name}`);

        return message;
    } catch (error: any) {
        throw new Error(`Failed to send message: ${error.message}`);
    }
}

// Send a simple categorized message
export async function sendSimpleMessage(data: {
    senderId: number;
    receiverId: number;
    subject: string;
    content: string;
    category: MessageCategory;
}) {
    try {
        // Validate users exist
        const [sender, receiver] = await Promise.all([
            prisma.user.findUnique({
                where: { id: data.senderId },
                include: { user_roles: true }
            }),
            prisma.user.findUnique({
                where: { id: data.receiverId },
                include: { user_roles: true }
            })
        ]);

        if (!sender || !receiver) {
            throw new Error('Sender or receiver not found');
        }

        // Create message
        const message = await prisma.message.create({
            data: {
                sender_id: data.senderId,
                receiver_id: data.receiverId,
                subject: data.subject,
                content: data.content,
                status: MessageStatus.SENT
            },
            include: {
                sender: {
                    include: { user_roles: true }
                },
                receiver: {
                    include: { user_roles: true }
                }
            }
        });

        // Send notification to receiver (popup — direct messages are urgent).
        await sendNotification({
            user_id: data.receiverId,
            title: `New ${data.category.toLowerCase()} message from ${sender.name}`,
            message: `New ${data.category} message from ${sender.name}: ${data.subject}`,
            sender_id: data.senderId,
            category: 'GENERAL',
            priority: 'HIGH',
            entity_type: 'Message',
            entity_id: message.id,
            action_url: `/messages/${message.id}`,
        });

        // Parent inbox integration — see comment in sendDirectMessage. Same
        // rationale: generic send site, so role-check the receiver.
        await notifyIfReceiverIsParent(data.receiverId, data.senderId, message.id, data.subject, sender.name);

        return {
            success: true,
            message: 'Message sent successfully',
            data: message
        };
    } catch (error: any) {
        throw new Error(`Failed to send message: ${error.message}`);
    }
}

// Get conversation history between two users
export async function getConversationHistory(
    userId: number,
    otherUserId: number,
    page: number = 1,
    limit: number = 50
) {
    try {
        const skip = (page - 1) * limit;

        const messages = await prisma.message.findMany({
            where: {
                OR: [
                    { sender_id: userId, receiver_id: otherUserId },
                    { sender_id: otherUserId, receiver_id: userId }
                ]
            },
            include: {
                sender: { select: { id: true, name: true, matricule: true } },
                receiver: { select: { id: true, name: true, matricule: true } }
            },
            orderBy: { created_at: 'desc' },
            skip,
            take: limit
        });

        const total = await prisma.message.count({
            where: {
                OR: [
                    { sender_id: userId, receiver_id: otherUserId },
                    { sender_id: otherUserId, receiver_id: userId }
                ]
            }
        });

        // Mark messages as read
        await prisma.message.updateMany({
            where: {
                sender_id: otherUserId,
                receiver_id: userId,
                status: { in: [MessageStatus.SENT, MessageStatus.DELIVERED] }
            },
            data: {
                status: MessageStatus.READ
            }
        });

        return {
            messages: messages.reverse(), // Return in chronological order
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        };
    } catch (error: any) {
        throw new Error(`Failed to get conversation history: ${error.message}`);
    }
}

/**
 * Deletes a message for a specific user.
 * This is a "soft delete". If the user is the sender, it marks `deleted_by_sender`.
 * If they are the receiver, it marks `deleted_by_receiver`.
 * The message is only truly deleted from the DB if both have deleted it.
 *
 * @param messageId The ID of the message to delete.
 * @param userId The ID of the user requesting the deletion.
 * @returns An object indicating success or failure.
 */
export async function deleteMessageForUser(messageId: number, userId: number) {
    try {
        const message = await prisma.message.findUnique({
            where: { id: messageId },
        });

        if (!message) {
            return { success: false, error: "Message not found" };
        }

        // Check if the user is either the sender or the receiver
        if (message.sender_id !== userId && message.receiver_id !== userId) {
            return { success: false, error: "You are not authorized to delete this message" };
        }

        let updateData: { deleted_by_sender?: boolean; deleted_by_receiver?: boolean } = {};
        let canPermanentlyDelete = false;

        if (message.sender_id === userId) {
            updateData.deleted_by_sender = true;
            if (message.deleted_by_receiver) {
                canPermanentlyDelete = true;
            }
        } else { // user is the receiver
            updateData.deleted_by_receiver = true;
            if (message.deleted_by_sender) {
                canPermanentlyDelete = true;
            }
        }

        if (canPermanentlyDelete) {
            // Both parties have deleted the message, so we can remove it permanently
            await prisma.message.delete({
                where: { id: messageId },
            });
            return { success: true, message: "Message permanently deleted." };
        } else {
            // Only one party has deleted it, so we perform a soft delete
            await prisma.message.update({
                where: { id: messageId },
                data: updateData,
            });
            return { success: true, message: "Message has been removed from your view." };
        }

    } catch (error: any) {
        // Log the actual error for debugging
        console.error(`Failed to delete message ${messageId} for user ${userId}:`, error);
        // Return a generic error message to the user
        return { success: false, error: "An error occurred while deleting the message." };
    }
}


// Get user's messages with simplified format
export async function getSimpleMessages(userId: number, type: 'inbox' | 'sent' = 'inbox') {
    try {
        const whereClause = type === 'inbox'
            ? { receiver_id: userId, deleted_by_receiver: false }
            : { sender_id: userId, deleted_by_sender: false };

        const messages = await prisma.message.findMany({
            where: whereClause,
            include: {
                sender: {
                    include: { user_roles: true }
                },
                receiver: {
                    include: { user_roles: true }
                }
            },
            orderBy: { created_at: 'desc' },
            take: 50
        });

        const formattedMessages: SimpleMessage[] = messages.map(msg => ({
            id: msg.id,
            from: msg.sender.name,
            to: msg.receiver.name,
            subject: msg.subject || 'No Subject',
            content: msg.content,
            category: determineCategory(msg.subject, msg.content),
            date: msg.created_at.toISOString(),
            isRead: msg.status === 'READ',
            senderRole: msg.sender.user_roles?.[0]?.role || 'UNKNOWN',
            receiverRole: msg.receiver.user_roles?.[0]?.role || 'UNKNOWN'
        }));

        return formattedMessages;
    } catch (error: any) {
        throw new Error(`Failed to get messages: ${error.message}`);
    }
}

// Helper function to determine message category from content
function determineCategory(subject: string, content: string): MessageCategory {
    const text = `${subject} ${content}`.toLowerCase();

    if (text.includes('fee') || text.includes('payment') || text.includes('money') || text.includes('fcfa')) {
        return MessageCategory.FINANCIAL;
    }
    if (text.includes('discipline') || text.includes('behavior') || text.includes('late') || text.includes('absent')) {
        return MessageCategory.DISCIPLINARY;
    }
    if (text.includes('grade') || text.includes('marks') || text.includes('exam') || text.includes('class') || text.includes('subject')) {
        return MessageCategory.ACADEMIC;
    }

    return MessageCategory.GENERAL;
}

// Get all conversations for a user
export async function getUserConversations(userId: number): Promise<ConversationParticipant[]> {
    try {
        // Get all unique conversation partners
        const conversations = await prisma.message.findMany({
            where: {
                OR: [
                    { sender_id: userId },
                    { receiver_id: userId }
                ]
            },
            select: {
                id: true,
                subject: true,
                content: true,
                status: true,
                created_at: true,
                sender_id: true,
                receiver_id: true,
                sender: { select: { id: true, name: true, matricule: true } },
                receiver: { select: { id: true, name: true, matricule: true } }
            },
            orderBy: { created_at: 'desc' }
        });

        // Group by conversation partner
        const partnersMap = new Map<number, ConversationParticipant>();

        for (const message of conversations) {
            const partnerId = message.sender_id === userId ? message.receiver_id : message.sender_id;
            const partner = message.sender_id === userId ? message.receiver : message.sender;

            if (!partnersMap.has(partnerId)) {
                // Count unread messages from this partner
                const unreadCount = await prisma.message.count({
                    where: {
                        sender_id: partnerId,
                        receiver_id: userId,
                        status: { in: [MessageStatus.SENT, MessageStatus.DELIVERED] }
                    }
                });

                // Get user role
                const userRole = await prisma.userRole.findFirst({
                    where: { user_id: partnerId },
                    orderBy: { created_at: 'desc' }
                });

                partnersMap.set(partnerId, {
                    id: partnerId,
                    name: partner.name,
                    role: userRole?.role || 'PARENT',
                    matricule: partner.matricule || '',
                    unreadCount,
                    lastMessage: {
                        content: message.content.substring(0, 100) + (message.content.length > 100 ? '...' : ''),
                        timestamp: message.created_at,
                        isFromMe: message.sender_id === userId
                    }
                });
            }
        }

        return Array.from(partnersMap.values()).sort((a, b) =>
            (b.lastMessage?.timestamp || new Date(0)).getTime() - (a.lastMessage?.timestamp || new Date(0)).getTime()
        );
    } catch (error: any) {
        throw new Error(`Failed to get user conversations: ${error.message}`);
    }
}

// Get messages by filters
export async function getMessagesByFilters(
    userId: number,
    filters: MessageFilters,
    page: number = 1,
    limit: number = 20
) {
    try {
        const skip = (page - 1) * limit;

        const where: any = {
            OR: [
                { sender_id: userId },
                { receiver_id: userId }
            ]
        };

        if (filters.status) {
            where.status = filters.status;
        }

        if (filters.priority) {
            where.priority = filters.priority;
        }

        if (filters.dateFrom) {
            where.created_at = { gte: new Date(filters.dateFrom) };
        }

        if (filters.dateTo) {
            where.created_at = { ...where.created_at, lte: new Date(filters.dateTo) };
        }

        if (filters.search) {
            where.OR = [
                { subject: { contains: filters.search, mode: 'insensitive' } },
                { content: { contains: filters.search, mode: 'insensitive' } },
                { sender: { name: { contains: filters.search, mode: 'insensitive' } } },
                { receiver: { name: { contains: filters.search, mode: 'insensitive' } } }
            ];
        }

        const messages = await prisma.message.findMany({
            where,
            include: {
                sender: { select: { id: true, name: true, matricule: true } },
                receiver: { select: { id: true, name: true, matricule: true } }
            },
            orderBy: { created_at: 'desc' },
            skip,
            take: limit
        });

        const total = await prisma.message.count({ where });

        return {
            messages,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        };
    } catch (error: any) {
        throw new Error(`Failed to get messages: ${error.message}`);
    }
}

// Mark message as read
export async function markMessageAsRead(messageId: number, userId: number) {
    try {
        const message = await prisma.message.findUnique({
            where: { id: messageId }
        });

        if (!message) {
            throw new Error('Message not found');
        }

        if (message.receiver_id !== userId) {
            throw new Error('Not authorized to mark this message as read');
        }

        return await prisma.message.update({
            where: { id: messageId },
            data: {
                status: MessageStatus.READ
            }
        });
    } catch (error: any) {
        throw new Error(`Failed to mark message as read: ${error.message}`);
    }
}

// Get message by ID
export async function getMessageById(messageId: number, userId: number) {
    try {
        const message = await prisma.message.findUnique({
            where: { id: messageId },
            include: {
                sender: { select: { id: true, name: true, matricule: true } },
                receiver: { select: { id: true, name: true, matricule: true } }
            }
        });

        if (!message) {
            throw new Error('Message not found');
        }

        // Check if user is authorized to view this message
        if (message.sender_id !== userId && message.receiver_id !== userId) {
            throw new Error('Not authorized to view this message');
        }

        // Mark as read if user is the receiver
        if (message.receiver_id === userId && message.status !== MessageStatus.READ) {
            await prisma.message.update({
                where: { id: messageId },
                data: {
                    status: MessageStatus.READ
                }
            });
        }

        return message;
    } catch (error: any) {
        throw new Error(`Failed to get message: ${error.message}`);
    }
}

// Delete message
export async function deleteMessage(messageId: number, userId: number) {
    try {
        const message = await prisma.message.findUnique({
            where: { id: messageId }
        });

        if (!message) {
            throw new Error('Message not found');
        }

        if (message.sender_id !== userId) {
            throw new Error('Not authorized to delete this message');
        }

        return await prisma.message.delete({
            where: { id: messageId }
        });
    } catch (error: any) {
        throw new Error(`Failed to delete message: ${error.message}`);
    }
}

// Get message statistics for a user
export async function getMessageStats(userId: number) {
    try {
        const [totalSent, totalReceived, unreadCount, todaysMessages] = await Promise.all([
            prisma.message.count({
                where: { sender_id: userId }
            }),
            prisma.message.count({
                where: { receiver_id: userId }
            }),
            prisma.message.count({
                where: {
                    receiver_id: userId,
                    status: { in: [MessageStatus.SENT, MessageStatus.DELIVERED] }
                }
            }),
            prisma.message.count({
                where: {
                    OR: [
                        { sender_id: userId },
                        { receiver_id: userId }
                    ],
                    created_at: {
                        gte: new Date(new Date().setHours(0, 0, 0, 0))
                    }
                }
            })
        ]);

        return {
            totalSent,
            totalReceived,
            unreadCount,
            todaysMessages
        };
    } catch (error: any) {
        throw new Error(`Failed to get message statistics: ${error.message}`);
    }
}

// Get suggested contacts for a user (based on role relationships)
export async function getSuggestedContacts(userId: number) {
    try {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            include: {
                user_roles: true
            }
        });

        if (!user) {
            throw new Error('User not found');
        }

        const currentAcademicYear = await getCurrentAcademicYear();
        if (!currentAcademicYear) {
            throw new Error('No current academic year found');
        }

        const userRole = user.user_roles[0]?.role; // Get primary role
        let suggestedContacts = [];

        switch (userRole) {
            case 'PARENT':
                // Parents can contact teachers and administrators
                suggestedContacts = await prisma.user.findMany({
                    where: {
                        user_roles: {
                            some: {
                                role: { in: ['PARENT', 'TEACHER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'MANAGER'] }
                            }
                        },
                        id: { not: userId }
                    },
                    select: {
                        id: true,
                        name: true,
                        matricule: true,
                        user_roles: { select: { role: true } }
                    },
                    take: 10
                });
                break;

            case 'TEACHER':
            case 'HOD':
                // Teachers can contact parents, students, and administrators
                suggestedContacts = await prisma.user.findMany({
                    where: {
                        user_roles: {
                            some: {
                                role: { in: ['PARENT', 'TEACHER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'MANAGER'] }
                            }
                        },
                        id: { not: userId }
                    },
                    select: {
                        id: true,
                        name: true,
                        matricule: true,
                        user_roles: { select: { role: true } }
                    },
                    take: 10
                });
                break;

            default:
                // Administrators can contact everyone
                suggestedContacts = await prisma.user.findMany({
                    where: {
                        id: { not: userId }
                    },
                    select: {
                        id: true,
                        name: true,
                        matricule: true,
                        user_roles: { select: { role: true } }
                    },
                    take: 10
                });
        }

        return suggestedContacts.map(contact => ({
            id: contact.id,
            name: contact.name,
            matricule: contact.matricule,
            role: contact.user_roles[0]?.role || 'PARENT'
        }));
    } catch (error: any) {
        throw new Error(`Failed to get suggested contacts: ${error.message}`);
    }
}

// Get users by role for messaging (simplified)
export async function getUsersByRole(currentUserId: number, targetRole?: string) {
    try {
        const currentUser = await prisma.user.findUnique({
            where: { id: currentUserId },
            include: { user_roles: true }
        });

        if (!currentUser) {
            throw new Error('Current user not found');
        }

        const currentUserRole = currentUser.user_roles?.[0]?.role;

        // Define communication rules (simplified)
        let allowedRoles: string[] = [];

        switch (currentUserRole) {
            case 'PARENT':
                allowedRoles = ['TEACHER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'BURSAR', 'DISCIPLINE_MASTER'];
                break;
            case 'TEACHER':
                allowedRoles = ['PARENT', 'PRINCIPAL', 'VICE_PRINCIPAL', 'HOD', 'TEACHER'];
                break;
            case 'PRINCIPAL':
            case 'VICE_PRINCIPAL':
            case 'SUPER_MANAGER':
                allowedRoles = ['TEACHER', 'PARENT', 'HOD', 'BURSAR', 'DISCIPLINE_MASTER'];
                break;
            default:
                allowedRoles = ['TEACHER', 'PRINCIPAL', 'VICE_PRINCIPAL'];
        }

        const whereClause: any = {
            user_roles: {
                some: {
                    role: { in: allowedRoles }
                }
            },
            id: { not: currentUserId } // Exclude current user
        };

        if (targetRole && allowedRoles.includes(targetRole)) {
            whereClause.user_roles.some.role = targetRole;
        }

        const users = await prisma.user.findMany({
            where: whereClause,
            select: {
                id: true,
                name: true,
                matricule: true,
                user_roles: {
                    select: { role: true }
                }
            },
            orderBy: { name: 'asc' }
        });

        return users.map(user => ({
            id: user.id,
            name: user.name,
            matricule: user.matricule,
            role: user.user_roles?.[0]?.role || 'UNKNOWN'
        }));
    } catch (error: any) {
        throw new Error(`Failed to get users: ${error.message}`);
    }
} 