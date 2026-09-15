import prisma from '../../../config/db';
import { getCurrentAcademicYear } from '../../../utils/academicYear';
import { notifyIfReceiverIsParent } from './parentService';

// Types for Enhanced Messaging
export interface MessageThread {
    id: number;
    subject: string;
    category: string; // Mock category since not in schema
    participants: number[];
    participantNames: string[];
    participantRoles: string[];
    lastMessage: {
        id: number;
        content: string;
        senderId: number;
        senderName: string;
        timestamp: string;
    };
    messageCount: number;
    unreadCount: number;
    priority: string; // Mock priority since not in schema
    status: string;
    createdAt: string;
    updatedAt: string;
}

export interface MessageDetails {
    id: number;
    senderId: number;
    senderName: string;
    senderRole: string;
    receiverId: number;
    receiverName: string;
    receiverRole: string;
    subject?: string;
    content: string;
    status: string;
    priority: string; // Mock field
    category: string; // Mock field
    reactions: Array<{
        userId: number;
        userName: string;
        reaction: string;
        timestamp: string;
    }>; // Mock reactions
    timestamp: string;
    readAt?: string;
    deliveredAt?: string;
}

export interface MessagingStatistics {
    totalMessages: number;
    unreadMessages: number;
    messagesThisWeek: number;
    responseRate: number;
    averageResponseTime: number;
    messagesByCategory: Array<{
        category: string;
        count: number;
        unreadCount: number;
    }>;
    messagesByPriority: Array<{
        priority: string;
        count: number;
        urgentCount: number;
    }>;
    activeConversations: number;
    topCommunicators: Array<{
        userId: number;
        userName: string;
        messageCount: number;
        role: string;
    }>;
}

/**
 * Get enhanced messaging dashboard
 */
export async function getMessagingDashboard(userId: number, academicYearId?: number): Promise<any> {
    try {
        const currentYear = academicYearId ?
            await prisma.academicYear.findUnique({ where: { id: academicYearId } }) :
            await getCurrentAcademicYear();

        if (!currentYear) {
            throw new Error('No academic year found');
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        // For demonstration purposes, using mock data since messaging tables might not exist yet
        const mockDashboard: any = {
            totalThreads: 25,
            unreadMessages: 8,
            urgentMessages: 2,
            activeThreads: 18,
            recentActivity: 12,
            messagesByCategory: [
                { category: 'ACADEMIC', count: 15, unreadCount: 3 },
                { category: 'ADMINISTRATIVE', count: 8, unreadCount: 2 },
                { category: 'DISCIPLINARY', count: 5, unreadCount: 1 },
                { category: 'FINANCIAL', count: 3, unreadCount: 1 },
                { category: 'GENERAL', count: 12, unreadCount: 1 },
                { category: 'EMERGENCY', count: 1, unreadCount: 0 }
            ],
            quickStats: {
                sentToday: 5,
                receivedToday: 8,
                pendingResponses: 3,
                resolvedToday: 2
            },
            recentThreads: [
                {
                    id: 1,
                    subject: 'Monthly Fee Collection Update',
                    participants: [
                        { userId: 1, userName: 'Bursar', userRole: 'BURSAR', isActive: true },
                        { userId: 2, userName: 'Principal', userRole: 'PRINCIPAL', isActive: true }
                    ],
                    messageCount: 5,
                    lastMessageAt: new Date().toISOString(),
                    lastMessagePreview: 'The collection rate has improved to 85%...',
                    priority: 'MEDIUM',
                    category: 'FINANCIAL',
                    status: 'ACTIVE',
                    tags: ['fees', 'collection', 'monthly-report'],
                    createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
                    createdBy: { id: 1, name: 'Bursar', role: 'BURSAR' }
                },
                {
                    id: 2,
                    subject: 'Student Behavioral Intervention Required',
                    participants: [
                        { userId: 3, userName: 'Discipline Master', userRole: 'DISCIPLINE_MASTER', isActive: true },
                        { userId: 4, userName: 'Vice Principal', userRole: 'VICE_PRINCIPAL', isActive: true },
                        { userId: 5, userName: 'Parent', userRole: 'PARENT', isActive: true }
                    ],
                    messageCount: 8,
                    lastMessageAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
                    lastMessagePreview: 'Meeting scheduled for tomorrow at 2 PM...',
                    priority: 'HIGH',
                    category: 'DISCIPLINARY',
                    status: 'ACTIVE',
                    tags: ['intervention', 'meeting', 'urgent'],
                    createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
                    createdBy: { id: 3, name: 'Discipline Master', role: 'DISCIPLINE_MASTER' }
                }
            ],
            urgentAlerts: [
                {
                    id: 1,
                    subject: 'Emergency: School Closure Tomorrow',
                    sender: 'Principal',
                    priority: 'URGENT',
                    sentAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
                    category: 'EMERGENCY'
                },
                {
                    id: 2,
                    subject: 'Payment Deadline Reminder',
                    sender: 'Bursar',
                    priority: 'HIGH',
                    sentAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
                    category: 'FINANCIAL'
                }
            ]
        };

        return mockDashboard;
    } catch (error) {
        throw new Error(`Failed to fetch messaging dashboard: ${error}`);
    }
}

/**
 * Get all message threads for a user
 */
export async function getMessageThreads(userId: number, filters: {
    category?: string;
    priority?: string;
    status?: string;
    page?: number;
    limit?: number;
} = {}): Promise<{ threads: MessageThread[]; totalCount: number; pagination: any }> {
    try {
        const page = filters.page || 1;
        const limit = filters.limit || 20;
        const skip = (page - 1) * limit;

        // Get messages where user is sender or receiver
        const messages = await prisma.message.findMany({
            where: {
                OR: [
                    { sender_id: userId },
                    { receiver_id: userId }
                ]
            },
            include: {
                sender: {
                    include: {
                        user_roles: true
                    }
                },
                receiver: {
                    include: {
                        user_roles: true
                    }
                }
            },
            orderBy: {
                created_at: 'desc'
            }
        });

        // Group messages by conversation (using subject as thread identifier)
        const threadMap = new Map<string, any>();

        messages.forEach(message => {
            const threadKey = message.subject || `${Math.min(message.sender_id, message.receiver_id)}-${Math.max(message.sender_id, message.receiver_id)}`;

            if (!threadMap.has(threadKey)) {
                const otherUserId = message.sender_id === userId ? message.receiver_id : message.sender_id;
                const otherUser = message.sender_id === userId ? message.receiver : message.sender;

                threadMap.set(threadKey, {
                    id: parseInt(threadKey.split('-')[0]) || message.id,
                    subject: message.subject || `Conversation with ${otherUser.name}`,
                    category: 'GENERAL', // Mock category
                    participants: [message.sender_id, message.receiver_id],
                    participantNames: [message.sender.name, message.receiver.name],
                    participantRoles: [
                        message.sender.user_roles[0]?.role || 'USER',
                        message.receiver.user_roles[0]?.role || 'USER'
                    ],
                    messages: [],
                    priority: 'MEDIUM', // Mock priority
                    status: 'ACTIVE',
                    createdAt: message.created_at.toISOString(),
                    updatedAt: message.updated_at.toISOString()
                });
            }

            threadMap.get(threadKey).messages.push(message);
        });

        // Convert to array and process
        const threads: MessageThread[] = Array.from(threadMap.values()).map(thread => {
            const sortedMessages = thread.messages.sort((a: any, b: any) =>
                new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
            );

            const lastMessage = sortedMessages[0];
            const unreadCount = sortedMessages.filter((msg: any) =>
                msg.receiver_id === userId && msg.status !== 'READ'
            ).length;

            return {
                id: thread.id,
                subject: thread.subject,
                category: thread.category,
                participants: [...new Set(thread.participants)],
                participantNames: [...new Set(thread.participantNames)],
                participantRoles: [...new Set(thread.participantRoles)],
                lastMessage: lastMessage ? {
                    id: lastMessage.id,
                    content: lastMessage.content.substring(0, 100) + (lastMessage.content.length > 100 ? '...' : ''),
                    senderId: lastMessage.sender_id,
                    senderName: lastMessage.sender.name,
                    timestamp: lastMessage.created_at.toISOString()
                } : null,
                messageCount: sortedMessages.length,
                unreadCount,
                priority: thread.priority,
                status: thread.status,
                createdAt: thread.createdAt,
                updatedAt: thread.updatedAt
            };
        }).filter(thread => thread.lastMessage !== null) as MessageThread[];

        // Apply filters
        let filteredThreads: MessageThread[] = threads;
        if (filters.category && filters.category !== 'ALL') {
            filteredThreads = filteredThreads.filter(thread => thread.category === filters.category);
        }
        if (filters.priority && filters.priority !== 'ALL') {
            filteredThreads = filteredThreads.filter(thread => thread.priority === filters.priority);
        }
        if (filters.status && filters.status !== 'ALL') {
            filteredThreads = filteredThreads.filter(thread => thread.status === filters.status);
        }

        // Pagination
        const totalCount = filteredThreads.length;
        const paginatedThreads = filteredThreads.slice(skip, skip + limit);

        return {
            threads: paginatedThreads,
            totalCount,
            pagination: {
                page,
                limit,
                totalPages: Math.ceil(totalCount / limit),
                hasNext: page * limit < totalCount,
                hasPrev: page > 1
            }
        };
    } catch (error) {
        console.error('Error in getMessageThreads:', error);
        throw new Error(`Failed to get message threads: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

/**
 * Get messages in a thread
 */
export async function getThreadMessages(userId: number, threadId: number, filters: {
    page?: number;
    limit?: number;
} = {}): Promise<{ messages: MessageDetails[]; totalCount: number; pagination: any }> {
    try {
        const page = filters.page || 1;
        const limit = filters.limit || 50;
        const skip = (page - 1) * limit;

        // For simplicity, we'll get messages where one of the participants is the current user
        // and the other is derived from threadId (this is a simplified approach)
        const messages = await prisma.message.findMany({
            where: {
                OR: [
                    { sender_id: userId },
                    { receiver_id: userId }
                ]
            },
            include: {
                sender: {
                    include: {
                        user_roles: true
                    }
                },
                receiver: {
                    include: {
                        user_roles: true
                    }
                }
            },
            orderBy: {
                created_at: 'desc'
            },
            skip,
            take: limit
        });

        const totalCount = await prisma.message.count({
            where: {
                OR: [
                    { sender_id: userId },
                    { receiver_id: userId }
                ]
            }
        });

        const formattedMessages = messages.map(message => ({
            id: message.id,
            senderId: message.sender_id,
            senderName: message.sender.name,
            senderRole: message.sender.user_roles[0]?.role || 'USER',
            receiverId: message.receiver_id,
            receiverName: message.receiver.name,
            receiverRole: message.receiver.user_roles[0]?.role || 'USER',
            subject: message.subject,
            content: message.content,
            status: message.status,
            priority: 'MEDIUM', // Mock priority
            category: 'GENERAL', // Mock category
            reactions: [], // Mock reactions array
            timestamp: message.created_at.toISOString(),
            readAt: message.status === 'READ' ? message.updated_at.toISOString() : undefined,
            deliveredAt: message.status !== 'SENT' ? message.updated_at.toISOString() : undefined
        }));

        return {
            messages: formattedMessages,
            totalCount,
            pagination: {
                page,
                limit,
                totalPages: Math.ceil(totalCount / limit),
                hasNext: page * limit < totalCount,
                hasPrev: page > 1
            }
        };
    } catch (error) {
        console.error('Error in getThreadMessages:', error);
        throw new Error(`Failed to get thread messages: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

/**
 * Create a new message thread
 */
export async function createMessageThread(
    creatorId: number,
    data: {
        subject: string;
        participants: number[];
        category: string;
        priority: string;
        initialMessage: string;
        tags?: string[];
    }
): Promise<MessageThread> {
    try {
        // In a real implementation, this would create records in messaging tables
        const newThread: MessageThread = {
            id: Date.now(), // Mock ID
            subject: data.subject,
            category: data.category, // Mock category
            participants: data.participants,
            participantNames: data.participants.map(id => `User ${id}`), // Mock names
            participantRoles: data.participants.map(id => 'TEACHER'), // Mock roles
            lastMessage: { // Mock last message
                id: Date.now(),
                content: data.initialMessage,
                senderId: creatorId,
                senderName: 'Current User', // Would be fetched from database
                timestamp: new Date().toISOString()
            },
            messageCount: 1,
            unreadCount: 0, // Mock unread count
            priority: data.priority, // Mock priority
            status: 'ACTIVE',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        return newThread;
    } catch (error) {
        throw new Error(`Failed to create message thread: ${error}`);
    }
}

/**
 * Send a message
 */
export async function sendMessage(data: {
    senderId: number;
    receiverId: number;
    subject?: string;
    content: string;
    priority?: string;
    category?: string;
}): Promise<{ success: boolean; message: string; data: MessageDetails }> {
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

        if (!sender) {
            throw new Error('Sender not found');
        }
        if (!receiver) {
            throw new Error('Receiver not found');
        }

        // Create message
        const message = await prisma.message.create({
            data: {
                sender_id: data.senderId,
                receiver_id: data.receiverId,
                subject: data.subject || 'No Subject',
                content: data.content,
                status: 'SENT'
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

        const formattedMessage: MessageDetails = {
            id: message.id,
            senderId: message.sender_id,
            senderName: message.sender.name,
            senderRole: message.sender.user_roles[0]?.role || 'USER',
            receiverId: message.receiver_id,
            receiverName: message.receiver.name,
            receiverRole: message.receiver.user_roles[0]?.role || 'USER',
            subject: message.subject,
            content: message.content,
            status: message.status,
            priority: data.priority || 'MEDIUM',
            category: data.category || 'GENERAL',
            reactions: [],
            timestamp: message.created_at.toISOString(),
            deliveredAt: message.created_at.toISOString()
        };

        // Parent inbox integration: this is a generic send API (staff <->
        // staff or staff <-> parent). The helper role-checks the receiver
        // and only fires the parent-portal notification when the receiver
        // actually holds the PARENT role.
        await notifyIfReceiverIsParent(
            message.receiver_id,
            message.sender_id,
            message.id,
            message.subject,
            message.sender.name
        );

        return {
            success: true,
            message: 'Message sent successfully',
            data: formattedMessage
        };
    } catch (error) {
        console.error('Error in sendMessage:', error);
        throw new Error(`Failed to send message: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

/**
 * Mark message as read
 */
export async function markMessageAsRead(messageId: number, userId: number): Promise<{ success: boolean; message: string }> {
    try {
        // Verify the user is the receiver
        const message = await prisma.message.findUnique({
            where: { id: messageId }
        });

        if (!message) {
            throw new Error('Message not found');
        }

        if (message.receiver_id !== userId) {
            throw new Error('Not authorized to mark this message as read');
        }

        await prisma.message.update({
            where: { id: messageId },
            data: { status: 'READ' }
        });

        return {
            success: true,
            message: 'Message marked as read'
        };
    } catch (error) {
        console.error('Error in markMessageAsRead:', error);
        throw new Error(`Failed to mark message as read: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

/**
 * Get messaging statistics
 */
export async function getMessagingStatistics(userId: number): Promise<MessagingStatistics> {
    try {
        const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

        const [
            totalMessages,
            unreadMessages,
            messagesThisWeek,
            allUserMessages
        ] = await Promise.all([
            prisma.message.count({
                where: {
                    OR: [
                        { sender_id: userId },
                        { receiver_id: userId }
                    ]
                }
            }),
            prisma.message.count({
                where: {
                    receiver_id: userId,
                    status: { not: 'READ' }
                }
            }),
            prisma.message.count({
                where: {
                    OR: [
                        { sender_id: userId },
                        { receiver_id: userId }
                    ],
                    created_at: { gte: oneWeekAgo }
                }
            }),
            prisma.message.findMany({
                where: {
                    OR: [
                        { sender_id: userId },
                        { receiver_id: userId }
                    ]
                },
                include: {
                    sender: {
                        include: { user_roles: true }
                    },
                    receiver: {
                        include: { user_roles: true }
                    }
                }
            })
        ]);

        // Mock categories and priorities since they don't exist in schema
        const messagesByCategory = [
            { category: 'GENERAL', count: Math.floor(totalMessages * 0.4), unreadCount: Math.floor(unreadMessages * 0.4) },
            { category: 'ACADEMIC', count: Math.floor(totalMessages * 0.3), unreadCount: Math.floor(unreadMessages * 0.3) },
            { category: 'ADMINISTRATIVE', count: Math.floor(totalMessages * 0.2), unreadCount: Math.floor(unreadMessages * 0.2) },
            { category: 'DISCIPLINARY', count: Math.floor(totalMessages * 0.1), unreadCount: Math.floor(unreadMessages * 0.1) }
        ];

        const messagesByPriority = [
            { priority: 'LOW', count: Math.floor(totalMessages * 0.5), urgentCount: 0 },
            { priority: 'MEDIUM', count: Math.floor(totalMessages * 0.3), urgentCount: 0 },
            { priority: 'HIGH', count: Math.floor(totalMessages * 0.15), urgentCount: Math.floor(totalMessages * 0.05) },
            { priority: 'URGENT', count: Math.floor(totalMessages * 0.05), urgentCount: Math.floor(totalMessages * 0.05) }
        ];

        // Calculate active conversations (unique participants)
        const participants = new Set();
        allUserMessages.forEach(msg => {
            if (msg.sender_id === userId) {
                participants.add(msg.receiver_id);
            } else {
                participants.add(msg.sender_id);
            }
        });
        const activeConversations = participants.size;

        // Top communicators
        const communicatorMap = new Map();
        allUserMessages.forEach(msg => {
            const otherUserId = msg.sender_id === userId ? msg.receiver_id : msg.sender_id;
            const otherUser = msg.sender_id === userId ? msg.receiver : msg.sender;

            if (!communicatorMap.has(otherUserId)) {
                communicatorMap.set(otherUserId, {
                    userId: otherUserId,
                    userName: otherUser.name,
                    messageCount: 0,
                    role: otherUser.user_roles[0]?.role || 'USER'
                });
            }
            communicatorMap.get(otherUserId).messageCount++;
        });

        const topCommunicators = Array.from(communicatorMap.values())
            .sort((a, b) => b.messageCount - a.messageCount)
            .slice(0, 5);

        return {
            totalMessages,
            unreadMessages,
            messagesThisWeek,
            responseRate: 85, // Mock response rate
            averageResponseTime: 2.5, // Mock average response time in hours
            messagesByCategory,
            messagesByPriority,
            activeConversations,
            topCommunicators
        };
    } catch (error) {
        console.error('Error in getMessagingStatistics:', error);
        throw new Error(`Failed to get messaging statistics: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

/**
 * Search messages
 */
export async function searchMessages(userId: number, query: string, filters: {
    category?: string;
    priority?: string;
    dateFrom?: string;
    dateTo?: string;
    senderId?: number;
    page?: number;
    limit?: number;
} = {}): Promise<{ messages: MessageDetails[]; totalCount: number; pagination: any }> {
    try {
        if (!query || query.trim().length < 2) {
            throw new Error('Search query must be at least 2 characters long');
        }

        const page = filters.page || 1;
        const limit = filters.limit || 20;
        const skip = (page - 1) * limit;

        const whereCondition: any = {
            OR: [
                { sender_id: userId },
                { receiver_id: userId }
            ],
            AND: [
                {
                    OR: [
                        { content: { contains: query, mode: 'insensitive' } },
                        { subject: { contains: query, mode: 'insensitive' } }
                    ]
                }
            ]
        };

        // Add additional filters
        if (filters.senderId) {
            whereCondition.AND.push({ sender_id: filters.senderId });
        }

        if (filters.dateFrom) {
            whereCondition.AND.push({ created_at: { gte: new Date(filters.dateFrom) } });
        }

        if (filters.dateTo) {
            whereCondition.AND.push({ created_at: { lte: new Date(filters.dateTo) } });
        }

        const [messages, totalCount] = await Promise.all([
            prisma.message.findMany({
                where: whereCondition,
                include: {
                    sender: {
                        include: { user_roles: true }
                    },
                    receiver: {
                        include: { user_roles: true }
                    }
                },
                orderBy: { created_at: 'desc' },
                skip,
                take: limit
            }),
            prisma.message.count({
                where: whereCondition
            })
        ]);

        const formattedMessages = messages.map(message => ({
            id: message.id,
            senderId: message.sender_id,
            senderName: message.sender.name,
            senderRole: message.sender.user_roles[0]?.role || 'USER',
            receiverId: message.receiver_id,
            receiverName: message.receiver.name,
            receiverRole: message.receiver.user_roles[0]?.role || 'USER',
            subject: message.subject,
            content: message.content,
            status: message.status,
            priority: 'MEDIUM', // Mock priority
            category: 'GENERAL', // Mock category
            reactions: [], // Mock reactions
            timestamp: message.created_at.toISOString(),
            readAt: message.status === 'READ' ? message.updated_at.toISOString() : undefined,
            deliveredAt: message.status !== 'SENT' ? message.updated_at.toISOString() : undefined
        }));

        return {
            messages: formattedMessages,
            totalCount,
            pagination: {
                page,
                limit,
                totalPages: Math.ceil(totalCount / limit),
                hasNext: page * limit < totalCount,
                hasPrev: page > 1
            }
        };
    } catch (error) {
        console.error('Error in searchMessages:', error);
        throw new Error(`Failed to search messages: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

/**
 * Get notification preferences (mock implementation)
 */
export async function getNotificationPreferences(userId: number): Promise<{
    emailNotifications: boolean;
    smsNotifications: boolean;
    pushNotifications: boolean;
    notificationCategories: Array<{
        category: string;
        enabled: boolean;
    }>;
}> {
    try {
        // Mock implementation since notification preferences aren't in schema
        return {
            emailNotifications: true,
            smsNotifications: false,
            pushNotifications: true,
            notificationCategories: [
                { category: 'GENERAL', enabled: true },
                { category: 'ACADEMIC', enabled: true },
                { category: 'ADMINISTRATIVE', enabled: false },
                { category: 'DISCIPLINARY', enabled: true },
                { category: 'FINANCIAL', enabled: true },
                { category: 'EMERGENCY', enabled: true }
            ]
        };
    } catch (error) {
        console.error('Error in getNotificationPreferences:', error);
        throw new Error(`Failed to get notification preferences: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

/**
 * Update notification preferences (mock implementation)
 */
export async function updateNotificationPreferences(userId: number, preferences: {
    emailNotifications?: boolean;
    smsNotifications?: boolean;
    pushNotifications?: boolean;
    notificationCategories?: Array<{
        category: string;
        enabled: boolean;
    }>;
}): Promise<{ success: boolean; message: string }> {
    try {
        // Mock implementation
        return {
            success: true,
            message: 'Notification preferences updated successfully'
        };
    } catch (error) {
        console.error('Error in updateNotificationPreferences:', error);
        throw new Error(`Failed to update notification preferences: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

/**
 * Add reaction to message (mock implementation)
 */
export async function addMessageReaction(messageId: number, userId: number, reaction: string): Promise<{ success: boolean; message: string }> {
    try {
        // Validate reaction type
        const validReactions = ['👍', '👎', '❤️', '😂', '😮', '😢', '😡'];
        if (!validReactions.includes(reaction)) {
            throw new Error('Invalid reaction type');
        }

        // Verify message exists and user has access
        const message = await prisma.message.findUnique({
            where: { id: messageId }
        });

        if (!message) {
            throw new Error('Message not found');
        }

        if (message.sender_id !== userId && message.receiver_id !== userId) {
            throw new Error('Not authorized to react to this message');
        }

        // Mock implementation - in real scenario, this would be stored in a reactions table
        return {
            success: true,
            message: 'Reaction added successfully'
        };
    } catch (error) {
        console.error('Error in addMessageReaction:', error);
        throw new Error(`Failed to add message reaction: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

/**
 * Archive thread (mock implementation)
 */
export async function archiveThread(threadId: number, userId: number): Promise<{ success: boolean; message: string }> {
    try {
        // Mock implementation - in real scenario, this would update thread status
        return {
            success: true,
            message: 'Thread archived successfully'
        };
    } catch (error) {
        console.error('Error in archiveThread:', error);
        throw new Error(`Failed to archive thread: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

/**
 * Unarchive thread (mock implementation)
 */
export async function unarchiveThread(threadId: number, userId: number): Promise<{ success: boolean; message: string }> {
    try {
        // Mock implementation - in real scenario, this would update thread status
        return {
            success: true,
            message: 'Thread unarchived successfully'
        };
    } catch (error) {
        console.error('Error in unarchiveThread:', error);
        throw new Error(`Failed to unarchive thread: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

/**
 * Delete message
 */
export async function deleteMessage(messageId: number, userId: number): Promise<{ success: boolean; message: string }> {
    try {
        // Verify message exists and user is the sender
        const message = await prisma.message.findUnique({
            where: { id: messageId }
        });

        if (!message) {
            throw new Error('Message not found');
        }

        if (message.sender_id !== userId) {
            throw new Error('Only the sender can delete this message');
        }

        await prisma.message.delete({
            where: { id: messageId }
        });

        return {
            success: true,
            message: 'Message deleted successfully'
        };
    } catch (error) {
        console.error('Error in deleteMessage:', error);
        throw new Error(`Failed to delete message: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

/**
 * Get communication matrix (which roles can message which roles)
 */
export async function getCommunicationMatrix(): Promise<{
    matrix: Record<string, string[]>;
    rules: string[];
}> {
    try {
        // Define communication rules
        const matrix = {
            'SUPER_MANAGER': ['PRINCIPAL', 'VICE_PRINCIPAL', 'BURSAR', 'DISCIPLINE_MASTER', 'HOD', 'TEACHER', 'PARENT'],
            'PRINCIPAL': ['SUPER_MANAGER', 'VICE_PRINCIPAL', 'BURSAR', 'DISCIPLINE_MASTER', 'HOD', 'TEACHER', 'PARENT'],
            'VICE_PRINCIPAL': ['SUPER_MANAGER', 'PRINCIPAL', 'BURSAR', 'DISCIPLINE_MASTER', 'HOD', 'TEACHER', 'PARENT'],
            'BURSAR': ['SUPER_MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'TEACHER', 'PARENT'],
            'DISCIPLINE_MASTER': ['SUPER_MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'TEACHER', 'PARENT'],
            'HOD': ['SUPER_MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'TEACHER'],
            'TEACHER': ['SUPER_MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'BURSAR', 'DISCIPLINE_MASTER', 'HOD', 'TEACHER', 'PARENT'],
            'PARENT': ['SUPER_MANAGER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'BURSAR', 'DISCIPLINE_MASTER', 'TEACHER'],
            'STUDENT': [] // Students cannot send direct messages in this system
        };

        const rules = [
            'All staff can communicate with management',
            'Teachers can communicate with parents',
            'Parents can communicate with staff but not other parents',
            'Students communicate through announcements only',
            'Super Manager and Principal have unrestricted communication',
            'Cross-departmental communication is allowed for coordination'
        ];

        return { matrix, rules };
    } catch (error) {
        console.error('Error in getCommunicationMatrix:', error);
        throw new Error(`Failed to get communication matrix: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
} 