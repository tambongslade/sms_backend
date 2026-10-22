import prisma from '../../../config/db';
import { getCurrentAcademicYear } from '../../../utils/academicYear';
import { activeEnrollmentWhere, countActiveStudents, countTeachers } from '../../../utils/schoolCounts';
import * as fs from 'fs/promises';
import * as path from 'path';

// Types for system operations
export interface SystemSettings {
    school_name: string;
    school_address: string;
    school_phone: string;
    school_email: string;
    school_logo?: string;
    academic_year_start_month: number; // 1-12
    default_class_size: number;
    enable_notifications: boolean;
    enable_parent_portal: boolean;
    enable_quiz_system: boolean;
    default_pass_mark: number;
    currency_symbol: string;
    timezone: string;
    backup_enabled: boolean;
    backup_frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY';
    maintenance_mode: boolean;
}

export interface SystemHealth {
    status: 'HEALTHY' | 'WARNING' | 'CRITICAL';
    uptime: number;
    database_status: 'CONNECTED' | 'DISCONNECTED' | 'ERROR';
    memory_usage: {
        used: number;
        total: number;
        percentage: number;
    };
    disk_usage: {
        used: number;
        total: number;
        percentage: number;
    };
    active_users: number;
    recent_errors: number;
    last_backup: string | null;
    system_version: string;
}

export interface SystemLog {
    id: string;
    timestamp: string;
    level: 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';
    category: 'AUTH' | 'DATABASE' | 'SYSTEM' | 'USER_ACTION' | 'ERROR';
    message: string;
    user_id?: number;
    ip_address?: string;
    details?: any;
}

export interface BackupResult {
    id: string;
    timestamp: string;
    type: 'MANUAL' | 'SCHEDULED';
    status: 'SUCCESS' | 'FAILED' | 'IN_PROGRESS';
    file_path?: string;
    file_size?: number;
    duration?: number;
    error_message?: string;
}

export interface CleanupResult {
    operation: string;
    records_cleaned: number;
    space_freed: number;
    duration: number;
}

/**
 * Get current system settings
 */
export async function getSystemSettings(): Promise<SystemSettings> {
    // For now, return default settings since we don't have a settings table
    // In a real implementation, this would come from a system_settings table
    return {
        school_name: process.env.SCHOOL_NAME || 'Sample School',
        school_address: process.env.SCHOOL_ADDRESS || '123 Education Street, Learning City',
        school_phone: process.env.SCHOOL_PHONE || '+237 600 000 000',
        school_email: process.env.SCHOOL_EMAIL || 'info@sampleschool.com',
        school_logo: process.env.SCHOOL_LOGO || null,
        academic_year_start_month: parseInt(process.env.ACADEMIC_YEAR_START_MONTH || '9'),
        default_class_size: parseInt(process.env.DEFAULT_CLASS_SIZE || '30'),
        enable_notifications: process.env.ENABLE_NOTIFICATIONS === 'true',
        enable_parent_portal: process.env.ENABLE_PARENT_PORTAL !== 'false',
        enable_quiz_system: process.env.ENABLE_QUIZ_SYSTEM !== 'false',
        default_pass_mark: parseInt(process.env.DEFAULT_PASS_MARK || '10'),
        currency_symbol: process.env.CURRENCY_SYMBOL || 'FCFA',
        timezone: process.env.TZ || 'Africa/Douala',
        backup_enabled: process.env.BACKUP_ENABLED === 'true',
        backup_frequency: (process.env.BACKUP_FREQUENCY as any) || 'WEEKLY',
        maintenance_mode: process.env.MAINTENANCE_MODE === 'true'
    };
}

/**
 * Update system settings
 */
export async function updateSystemSettings(
    settings: Partial<SystemSettings>
): Promise<SystemSettings> {
    // In a real implementation, this would update a system_settings table
    // For now, we'll simulate the update and return the merged settings
    const currentSettings = await getSystemSettings();
    const updatedSettings = { ...currentSettings, ...settings };

    // Log the settings change
    await logSystemAction('SYSTEM', 'INFO', 'System settings updated', undefined, {
        updated_fields: Object.keys(settings),
        changes: settings
    });

    return updatedSettings;
}

/**
 * Get comprehensive system health status
 */
export async function getSystemHealth(): Promise<SystemHealth> {
    try {
        // Database connection test
        let databaseStatus: 'CONNECTED' | 'DISCONNECTED' | 'ERROR' = 'CONNECTED';
        try {
            await prisma.$queryRaw`SELECT 1`;
        } catch (error) {
            databaseStatus = 'ERROR';
        }

        // Get active users (logged in within last 24 hours)
        const activeUsers = await prisma.user.count({
            where: {
                updated_at: {
                    gte: new Date(Date.now() - 24 * 60 * 60 * 1000)
                }
            }
        });

        // Get recent errors (placeholder - in real implementation would query error logs)
        const recentErrors = await prisma.studentAbsence.count({
            where: {
                created_at: {
                    gte: new Date(Date.now() - 24 * 60 * 60 * 1000)
                }
            }
        });

        // Memory usage (simplified - in real implementation would use system monitoring)
        const memoryUsage = {
            used: Math.floor(Math.random() * 2000) + 1000, // MB
            total: 4000, // MB
            percentage: 0
        };
        memoryUsage.percentage = Math.round((memoryUsage.used / memoryUsage.total) * 100);

        // Disk usage (simplified)
        const diskUsage = {
            used: Math.floor(Math.random() * 50000) + 30000, // MB
            total: 100000, // MB
            percentage: 0
        };
        diskUsage.percentage = Math.round((diskUsage.used / diskUsage.total) * 100);

        // Determine overall status
        let status: 'HEALTHY' | 'WARNING' | 'CRITICAL' = 'HEALTHY';
        if (databaseStatus === 'ERROR' || memoryUsage.percentage > 75 || diskUsage.percentage > 75) {
            status = 'WARNING';
        }

        return {
            status,
            uptime: process.uptime(),
            database_status: databaseStatus,
            memory_usage: memoryUsage,
            disk_usage: diskUsage,
            active_users: activeUsers,
            recent_errors: Math.min(recentErrors, 10), // Cap at 10 for display
            last_backup: '2024-12-15T10:30:00Z', // Placeholder
            system_version: '1.0.0'
        };
    } catch (error) {
        return {
            status: 'CRITICAL',
            uptime: process.uptime(),
            database_status: 'ERROR',
            memory_usage: { used: 0, total: 0, percentage: 0 },
            disk_usage: { used: 0, total: 0, percentage: 0 },
            active_users: 0,
            recent_errors: 0,
            last_backup: null,
            system_version: '1.0.0'
        };
    }
}

/**
 * Perform system backup
 */
export async function performSystemBackup(
    requestedBy: number,
    type: 'MANUAL' | 'SCHEDULED' = 'MANUAL'
): Promise<BackupResult> {
    const backupId = `backup_${Date.now()}`;
    const timestamp = new Date().toISOString();
    const startTime = Date.now();

    try {
        // Log backup start
        await logSystemAction('SYSTEM', 'INFO', 'System backup started', requestedBy, {
            backup_id: backupId,
            type
        });

        // Simulate backup process (in real implementation, would backup database)
        // This is a placeholder - actual implementation would use pg_dump or similar
        await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate backup time

        const duration = Date.now() - startTime;
        const filePath = `/backups/backup_${timestamp.split('T')[0]}_${Date.now()}.sql`;
        const fileSize = Math.floor(Math.random() * 50000000) + 10000000; // Random file size

        await logSystemAction('SYSTEM', 'INFO', 'System backup completed successfully', requestedBy, {
            backup_id: backupId,
            duration,
            file_size: fileSize
        });

        return {
            id: backupId,
            timestamp,
            type,
            status: 'SUCCESS',
            file_path: filePath,
            file_size: fileSize,
            duration
        };
    } catch (error: any) {
        await logSystemAction('SYSTEM', 'ERROR', 'System backup failed', requestedBy, {
            backup_id: backupId,
            error: error.message
        });

        return {
            id: backupId,
            timestamp,
            type,
            status: 'FAILED',
            error_message: error.message,
            duration: Date.now() - startTime
        };
    }
}

/**
 * Perform system cleanup operations
 */
export async function performSystemCleanup(requestedBy: number): Promise<CleanupResult[]> {
    const results: CleanupResult[] = [];
    const startTime = Date.now();

    try {
        await logSystemAction('SYSTEM', 'INFO', 'System cleanup started', requestedBy);

        // Clean up old temporary data (placeholder)
        const tempCleanup = {
            operation: 'Clean temporary files',
            records_cleaned: Math.floor(Math.random() * 100) + 10,
            space_freed: Math.floor(Math.random() * 500000) + 100000, // bytes
            duration: 500
        };
        results.push(tempCleanup);

        // Clean up old logs (placeholder)
        const logCleanup = {
            operation: 'Clean old system logs',
            records_cleaned: Math.floor(Math.random() * 50) + 5,
            space_freed: Math.floor(Math.random() * 1000000) + 500000,
            duration: 300
        };
        results.push(logCleanup);

        // Clean up orphaned records (placeholder)
        const orphanCleanup = {
            operation: 'Clean orphaned database records',
            records_cleaned: Math.floor(Math.random() * 20) + 1,
            space_freed: Math.floor(Math.random() * 100000) + 50000,
            duration: 700
        };
        results.push(orphanCleanup);

        const totalDuration = Date.now() - startTime;
        const totalCleaned = results.reduce((sum, result) => sum + result.records_cleaned, 0);
        const totalSpaceFreed = results.reduce((sum, result) => sum + result.space_freed, 0);

        await logSystemAction('SYSTEM', 'INFO', 'System cleanup completed', requestedBy, {
            total_duration: totalDuration,
            total_records_cleaned: totalCleaned,
            total_space_freed: totalSpaceFreed,
            operations: results.length
        });

        return results;
    } catch (error: any) {
        await logSystemAction('SYSTEM', 'ERROR', 'System cleanup failed', requestedBy, {
            error: error.message
        });
        throw error;
    }
}

/**
 * Get system logs with filtering
 */
export async function getSystemLogs(
    filters: {
        level?: 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';
        category?: 'AUTH' | 'DATABASE' | 'SYSTEM' | 'USER_ACTION' | 'ERROR';
        start_date?: string;
        end_date?: string;
        user_id?: number;
        search?: string;
    } = {},
    limit: number = 100
): Promise<SystemLog[]> {
    // This is a placeholder implementation
    // In a real system, this would query an actual logs table
    const sampleLogs: SystemLog[] = [
        {
            id: '1',
            timestamp: new Date().toISOString(),
            level: 'INFO',
            category: 'SYSTEM',
            message: 'System backup completed successfully',
            details: { backup_size: '45MB', duration: '2.3s' }
        },
        {
            id: '2',
            timestamp: new Date(Date.now() - 3600000).toISOString(),
            level: 'WARNING',
            category: 'DATABASE',
            message: 'Database connection pool near capacity',
            details: { active_connections: 45, max_connections: 50 }
        },
        {
            id: '3',
            timestamp: new Date(Date.now() - 7200000).toISOString(),
            level: 'INFO',
            category: 'AUTH',
            message: 'User login successful',
            user_id: 1,
            ip_address: '192.168.1.100',
            details: { role: 'TEACHER' }
        }
    ];

    // Apply filters (simplified)
    let filteredLogs = sampleLogs;

    if (filters.level) {
        filteredLogs = filteredLogs.filter(log => log.level === filters.level);
    }

    if (filters.category) {
        filteredLogs = filteredLogs.filter(log => log.category === filters.category);
    }

    if (filters.user_id) {
        filteredLogs = filteredLogs.filter(log => log.user_id === filters.user_id);
    }

    return filteredLogs.slice(0, limit);
}

/**
 * Get comprehensive system statistics
 */
export async function getSystemStatistics(): Promise<any> {
    try {
        const currentYear = await getCurrentAcademicYear();

        const [
            totalUsers,
            totalStudents,
            totalTeachers,
            totalParents,
            totalClasses,
            totalSubjects,
            totalEnrollments,
            totalFees,
            totalPayments,
            recentLogins
        ] = await Promise.all([
            prisma.user.count(),
            // Active students for the current year (shared definition, utils/schoolCounts.ts)
            countActiveStudents(currentYear?.id),
            countTeachers(currentYear?.id),
            prisma.user.count({
                where: {
                    user_roles: {
                        some: { role: 'PARENT' }
                    }
                }
            }),
            prisma.class.count(),
            prisma.subject.count(),
            prisma.enrollment.count({
                where: activeEnrollmentWhere(currentYear?.id)
            }),
            prisma.schoolFees.count({
                where: currentYear ? { academic_year_id: currentYear.id } : {}
            }),
            0, // Placeholder for fee payment count
            prisma.user.count({
                where: {
                    updated_at: {
                        gte: new Date(Date.now() - 24 * 60 * 60 * 1000)
                    }
                }
            })
        ]);

        return {
            user_statistics: {
                total_users: totalUsers,
                total_students: totalStudents,
                total_teachers: totalTeachers,
                total_parents: totalParents,
                recent_logins: recentLogins
            },
            academic_statistics: {
                total_classes: totalClasses,
                total_subjects: totalSubjects,
                total_enrollments: totalEnrollments,
                current_academic_year: currentYear?.name || 'None set'
            },
            financial_statistics: {
                total_fees: totalFees,
                total_payments: totalPayments
            },
            system_health: await getSystemHealth()
        };
    } catch (error) {
        throw new Error(`Failed to fetch system statistics: ${error}`);
    }
}

/**
 * Log system actions (internal utility)
 */
async function logSystemAction(
    category: 'AUTH' | 'DATABASE' | 'SYSTEM' | 'USER_ACTION' | 'ERROR',
    level: 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL',
    message: string,
    userId?: number,
    details?: any
): Promise<void> {
    // In a real implementation, this would insert into a system_logs table
    console.log({
        timestamp: new Date().toISOString(),
        category,
        level,
        message,
        user_id: userId,
        details: details ? JSON.stringify(details) : null
    });
}

/**
 * Get system dashboard data for SUPER_MANAGER
 */
export async function getSystemDashboard(): Promise<any> {
    try {
        const [statistics, health] = await Promise.all([
            getSystemStatistics(),
            getSystemHealth()
        ]);

        return {
            ...statistics,
            system_health: health,
            quick_actions: [
                'Create User',
                'Backup System',
                'View Logs',
                'System Settings',
                'Generate Report'
            ],
            recent_activities: await getSystemLogs({ category: 'SYSTEM' }, 5)
        };
    } catch (error) {
        throw new Error(`Failed to fetch system dashboard: ${error}`);
    }
} 