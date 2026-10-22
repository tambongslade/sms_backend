import prisma from '../../../config/db';
import { getCurrentAcademicYear } from '../../../utils/academicYear';
import { sendNotification } from './notificationService';

export interface AuditLogData {
    userId: number;
    action: string;
    entityType: string;
    entityId: number;
    changes?: any;
    ipAddress?: string;
    userAgent?: string;
    description?: string;
    severity?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

export interface AuditFilters {
    userId?: number;
    action?: string;
    entityType?: string;
    entityId?: number;
    severity?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    dateFrom?: string;
    dateTo?: string;
    search?: string;
}

// Create audit log entry
export async function createAuditLog(data: AuditLogData) {
    try {
        const currentAcademicYear = await getCurrentAcademicYear();

        const auditLog = await prisma.auditLog.create({
            data: {
                user_id: data.userId,
                action: data.action,
                table_name: data.entityType,
                record_id: data.entityId.toString(),
                old_values: data.changes?.oldValues || null,
                new_values: data.changes?.newValues || data.changes || null
            },
            include: {
                user: {
                    select: {
                        id: true,
                        name: true,
                        matricule: true,
                        user_roles: {
                            select: { role: true }
                        }
                    }
                }
            }
        });

        // Audit events are NOT pushed to users' notification feeds any more
        // (QA U7: admins' feeds were flooded with "System Change Alert ...
        // CREATE_USER" rows). They remain queryable via the audit-trail
        // endpoints; notifications are reserved for actionable items.

        return auditLog;
    } catch (error: any) {
        console.error('Failed to create audit log:', error);
        throw new Error(`Failed to create audit log: ${error.message}`);
    }
}

// Get audit logs with filters and pagination
export async function getAuditLogs(
    filters: AuditFilters,
    page: number = 1,
    limit: number = 50
) {
    try {
        const skip = (page - 1) * limit;

        const where: any = {};

        if (filters.userId) {
            where.user_id = filters.userId;
        }

        if (filters.action) {
            where.action = { contains: filters.action, mode: 'insensitive' };
        }

        if (filters.entityType) {
            where.table_name = filters.entityType;
        }

        if (filters.entityId) {
            where.record_id = filters.entityId.toString();
        }

        if (filters.dateFrom) {
            where.created_at = { gte: new Date(filters.dateFrom) };
        }

        if (filters.dateTo) {
            where.created_at = { ...where.created_at, lte: new Date(filters.dateTo) };
        }

        if (filters.search) {
            where.OR = [
                { action: { contains: filters.search, mode: 'insensitive' } },
                { table_name: { contains: filters.search, mode: 'insensitive' } },
                { user: { name: { contains: filters.search, mode: 'insensitive' } } }
            ];
        }

        const [auditLogs, total] = await Promise.all([
            prisma.auditLog.findMany({
                where,
                include: {
                    user: {
                        select: {
                            id: true,
                            name: true,
                            matricule: true,
                            user_roles: {
                                select: { role: true }
                            }
                        }
                    }
                },
                orderBy: { created_at: 'desc' },
                skip,
                take: limit
            }),
            prisma.auditLog.count({ where })
        ]);

        return {
            auditLogs,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        };
    } catch (error: any) {
        throw new Error(`Failed to get audit logs: ${error.message}`);
    }
}

// Get audit statistics
export async function getAuditStats(userId?: number) {
    try {
        const where: any = {};
        if (userId) {
            where.user_id = userId;
        }

        const [
            totalActions,
            todaysActions,
            topUsers,
            topActions,
            recentActivities
        ] = await Promise.all([
            prisma.auditLog.count({ where }),
            prisma.auditLog.count({
                where: {
                    ...where,
                    created_at: {
                        gte: new Date(new Date().setHours(0, 0, 0, 0))
                    }
                }
            }),
            prisma.auditLog.groupBy({
                by: ['user_id'],
                _count: {
                    id: true
                },
                where,
                orderBy: {
                    _count: {
                        id: 'desc'
                    }
                },
                take: 5
            }),
            prisma.auditLog.groupBy({
                by: ['action'],
                _count: {
                    id: true
                },
                where,
                orderBy: {
                    _count: {
                        id: 'desc'
                    }
                },
                take: 5
            }),
            prisma.auditLog.findMany({
                where,
                include: {
                    user: {
                        select: {
                            id: true,
                            name: true,
                            matricule: true
                        }
                    }
                },
                orderBy: { created_at: 'desc' },
                take: 10
            })
        ]);

        // Get user names for top users
        const userIds = topUsers.map(user => user.user_id);
        const users = await prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, name: true, matricule: true }
        });

        const topUsersWithNames = topUsers.map(user => ({
            ...user,
            user: users.find(u => u.id === user.user_id)
        }));

        return {
            totalActions,
            todaysActions,
            topUsers: topUsersWithNames,
            topActions,
            recentActivities
        };
    } catch (error: any) {
        throw new Error(`Failed to get audit statistics: ${error.message}`);
    }
}

// Get audit trail for specific entity
export async function getEntityAuditTrail(
    entityType: string,
    entityId: number,
    page: number = 1,
    limit: number = 20
) {
    try {
        const skip = (page - 1) * limit;

        const [auditLogs, total] = await Promise.all([
            prisma.auditLog.findMany({
                where: {
                    table_name: entityType,
                    record_id: entityId.toString()
                },
                include: {
                    user: {
                        select: {
                            id: true,
                            name: true,
                            matricule: true,
                            user_roles: {
                                select: { role: true }
                            }
                        }
                    }
                },
                orderBy: { created_at: 'desc' },
                skip,
                take: limit
            }),
            prisma.auditLog.count({
                where: {
                    table_name: entityType,
                    record_id: entityId.toString()
                }
            })
        ]);

        return {
            auditLogs,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        };
    } catch (error: any) {
        throw new Error(`Failed to get entity audit trail: ${error.message}`);
    }
}

// Get user activity summary
export async function getUserActivitySummary(
    userId: number,
    dateFrom?: string,
    dateTo?: string
) {
    try {
        const where: any = { user_id: userId };

        if (dateFrom) {
            where.created_at = { gte: new Date(dateFrom) };
        }

        if (dateTo) {
            where.created_at = { ...where.created_at, lte: new Date(dateTo) };
        }

        const [
            totalActions,
            actionsByType,
            entitiesModified,
            recentActions
        ] = await Promise.all([
            prisma.auditLog.count({ where }),
            prisma.auditLog.groupBy({
                by: ['action'],
                _count: { id: true },
                where,
                orderBy: { _count: { id: 'desc' } }
            }),
            prisma.auditLog.groupBy({
                by: ['table_name'],
                _count: { id: true },
                where,
                orderBy: { _count: { id: 'desc' } }
            }),
            prisma.auditLog.findMany({
                where,
                orderBy: { created_at: 'desc' },
                take: 10
            })
        ]);

        return {
            totalActions,
            actionsByType,
            entitiesModified,
            recentActions
        };
    } catch (error: any) {
        throw new Error(`Failed to get user activity summary: ${error.message}`);
    }
}

// Notify about audit trail changes -- no longer called (see createAuditLog).
// Kept for reference; do not re-enable without filtering to actionable events.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function notifyAuditTrailChange(auditLog: any) {
    try {
        // Get administrators to notify
        const administrators = await prisma.user.findMany({
            where: {
                user_roles: {
                    some: {
                        role: { in: ['SUPER_MANAGER', 'MANAGER', 'PRINCIPAL'] }
                    }
                }
            },
            select: { id: true }
        });

        // Send notifications to administrators
        for (const admin of administrators) {
            await sendNotification({
                user_id: admin.id,
                message: `System Change Alert: ${auditLog.user.name} performed: ${auditLog.action} on ${auditLog.table_name} (ID: ${auditLog.record_id})`
            });
        }
    } catch (error: any) {
        console.error('Failed to send audit trail notifications:', error);
    }
}

// Helper function to determine severity based on action and entity
export function determineSeverity(action: string, entityType: string): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
    // Critical actions
    if (action.includes('DELETE') || action.includes('PERMANENTLY_REMOVE')) {
        return 'CRITICAL';
    }

    // High severity actions
    if (
        action.includes('CREATE_USER') ||
        action.includes('ASSIGN_ROLE') ||
        action.includes('MODIFY_PERMISSIONS') ||
        action.includes('FINALIZE_EXAM') ||
        action.includes('GENERATE_REPORT') ||
        entityType === 'AcademicYear'
    ) {
        return 'HIGH';
    }

    // Medium severity actions
    if (
        action.includes('UPDATE') ||
        action.includes('MODIFY') ||
        action.includes('ENROLL') ||
        action.includes('ASSIGN')
    ) {
        return 'MEDIUM';
    }

    // Low severity actions
    return 'LOW';
}

// Auto-log function for middleware
export async function autoLog(
    userId: number,
    action: string,
    entityType: string,
    entityId: number,
    changes?: any,
    request?: any
) {
    try {
        const severity = determineSeverity(action, entityType);

        await createAuditLog({
            userId,
            action,
            entityType,
            entityId,
            changes,
            ipAddress: request?.ip || request?.connection?.remoteAddress,
            userAgent: request?.get('User-Agent'),
            description: `${action} performed on ${entityType} (ID: ${entityId})`,
            severity
        });
    } catch (error: any) {
        console.error('Auto-log failed:', error);
        // Don't throw error to prevent breaking the main operation
    }
}

// Bulk create audit logs
export async function bulkCreateAuditLogs(auditLogs: AuditLogData[]) {
    try {
        const currentAcademicYear = await getCurrentAcademicYear();

        const logsToCreate = auditLogs.map(log => ({
            user_id: log.userId,
            action: log.action,
            table_name: log.entityType,
            record_id: log.entityId.toString(),
            old_values: log.changes?.oldValues || null,
            new_values: log.changes?.newValues || log.changes || null
        }));

        const createdLogs = await prisma.auditLog.createMany({
            data: logsToCreate
        });

        return createdLogs;
    } catch (error: any) {
        console.error('Failed to bulk create audit logs:', error);
        throw new Error(`Failed to bulk create audit logs: ${error.message}`);
    }
} 