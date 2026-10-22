import { Request, Response, NextFunction } from 'express';
import { autoLog } from '../services/auditTrailService';

// Middleware to automatically log CRUD operations
export function auditTrailMiddleware(entityType: string, operation: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const originalJson = res.json;

    res.json = function (data: any) {
      // Only log if the operation was successful
      if (data.success) {
        const userId = req.user?.id;

        if (userId) {
          const entityId = getEntityId(req, data, operation);
          const changes = getChanges(req, data, operation);

          // Log the action (don't await to avoid blocking response)
          autoLog(
            userId,
            operation,
            entityType,
            entityId,
            changes,
            req
          ).catch(error => {
            console.error('Audit trail logging failed:', error);
          });
        }
      }

      return originalJson.call(this, data);
    };

    next();
  };
}

// Helper function to extract entity ID from request or response
function getEntityId(req: Request, data: any, operation: string): number {
  // For updates and deletes, ID is usually in params
  if (req.params.id) {
    return parseInt(req.params.id);
  }

  // For creates, ID is usually in response data
  if (data.data && data.data.id) {
    return data.data.id;
  }

  // For bulk operations, use first ID or 0
  if (data.data && Array.isArray(data.data) && data.data.length > 0) {
    return data.data[0].id || 0;
  }

  return 0;
}

// Helper function to extract changes from request
function getChanges(req: Request, data: any, operation: string): any {
  const changes: any = {};

  switch (operation) {
    case 'CREATE':
      changes.created = req.body;
      break;
    case 'UPDATE':
      changes.updated = req.body;
      changes.entityId = req.params.id;
      break;
    case 'DELETE':
      changes.deleted = { id: req.params.id };
      break;
    case 'BULK_CREATE':
      changes.created = req.body;
      changes.count = Array.isArray(req.body) ? req.body.length : 1;
      break;
    case 'BULK_UPDATE':
      changes.updated = req.body;
      changes.filter = req.query;
      break;
    case 'BULK_DELETE':
      changes.deleted = req.body;
      changes.filter = req.query;
      break;
    default:
      changes.data = req.body;
      changes.query = req.query;
  }

  return changes;
}

// Specific audit middlewares for different entities
export const auditStudent = auditTrailMiddleware('Student', 'MODIFY_STUDENT');
export const auditUser = auditTrailMiddleware('User', 'MODIFY_USER');
export const auditClass = auditTrailMiddleware('Class', 'MODIFY_CLASS');
export const auditExam = auditTrailMiddleware('Exam', 'MODIFY_EXAM');
export const auditFee = auditTrailMiddleware('Fee', 'MODIFY_FEE');
export const auditEnrollment = auditTrailMiddleware('Enrollment', 'MODIFY_ENROLLMENT');
export const auditAcademicYear = auditTrailMiddleware('AcademicYear', 'MODIFY_ACADEMIC_YEAR');

// Critical action middleware for high-security operations
export function criticalActionMiddleware(action: string, entityType: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const originalJson = res.json;

    res.json = function (data: any) {
      if (data.success) {
        const userId = req.user?.id;

        if (userId) {
          const entityId = getEntityId(req, data, action);
          const changes = getChanges(req, data, action);

          // Log critical action with high severity
          autoLog(
            userId,
            action,
            entityType,
            entityId,
            changes,
            req
          ).catch(error => {
            console.error('Critical action audit logging failed:', error);
          });
        }
      }

      return originalJson.call(this, data);
    };

    next();
  };
}

// Authentication audit middleware
export function authAuditMiddleware(req: Request, res: Response, next: NextFunction) {
  const originalJson = res.json;

  res.json = function (data: any) {
    const action = req.url.includes('change-password') ? 'CHANGE_PASSWORD' :
      req.url.includes('login') ? 'LOGIN_ATTEMPT' :
      req.url.includes('logout') ? 'LOGOUT' : 'AUTH_ACTION';

    if (data.success) {
      if (data.data && data.data.user) {
        // Login/register — user object is in response payload
        autoLog(
          data.data.user.id,
          action,
          'User',
          data.data.user.id,
          {
            success: true,
            matricule: data.data.user.matricule,
            role: data.data.user.role
          },
          req
        ).catch(error => {
          console.error('Auth audit logging failed:', error);
        });
      } else {
        // Change-password / logout: no user in payload — fall back to the authenticated caller.
        const authedUserId = (req as any).user?.id;
        if (authedUserId) {
          autoLog(
            authedUserId,
            action,
            'User',
            authedUserId,
            { success: true },
            req
          ).catch(error => {
            console.error('Auth audit logging failed:', error);
          });
        }
      }
    }
    // Failed authentication is intentionally not written to AuditLog:
    // user_id is a non-null FK to User.id, so logging with 0/unknown violates
    // the constraint and spams the error log on every bad login attempt.

    return originalJson.call(this, data);
  };

  next();
}

// Role change audit middleware
export function roleChangeAuditMiddleware(req: Request, res: Response, next: NextFunction) {
  const originalJson = res.json;

  res.json = function (data: any) {
    if (data.success) {
      const userId = req.user?.id;

      if (userId) {
        const targetUserId = parseInt(req.params.userId || req.params.id || req.body.userId || 0);

        autoLog(
          userId,
          'ROLE_CHANGE',
          'User',
          targetUserId,
          {
            newRoles: req.body.roles,
            academicYearId: req.body.academicYearId
          },
          req
        ).catch(error => {
          console.error('Role change audit logging failed:', error);
        });
      }
    }

    return originalJson.call(this, data);
  };

  next();
}

// Data export audit middleware
export function dataExportAuditMiddleware(entityType: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const originalJson = res.json;

    res.json = function (data: any) {
      if (data.success) {
        const userId = req.user?.id;

        if (userId) {
          autoLog(
            userId,
            'DATA_EXPORT',
            entityType,
            0,
            {
              exportType: entityType,
              filters: req.query,
              recordCount: Array.isArray(data.data) ? data.data.length : 1
            },
            req
          ).catch(error => {
            console.error('Data export audit logging failed:', error);
          });
        }
      }

      return originalJson.call(this, data);
    };

    next();
  };
}

// Bulk operation audit middleware
export function bulkOperationAuditMiddleware(operation: string, entityType: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const originalJson = res.json;

    res.json = function (data: any) {
      if (data.success) {
        const userId = req.user?.id;

        if (userId) {
          const count = Array.isArray(req.body) ? req.body.length : 1;

          autoLog(
            userId,
            `BULK_${operation}`,
            entityType,
            0,
            {
              operation,
              count,
              data: req.body
            },
            req
          ).catch(error => {
            console.error('Bulk operation audit logging failed:', error);
          });
        }
      }

      return originalJson.call(this, data);
    };

    next();
  };
} 