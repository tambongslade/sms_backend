/**
 * @swagger
 * components:
 *   securitySchemes:
 *     bearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 *       description: |
 *         JWT authentication for API endpoints. 
 *         Tokens are obtained from the `/auth/login` endpoint and should be included
 *         in the Authorization header as `Bearer {token}`.
 *         
 *         Tokens are valid for 24 hours after which they expire and a new login is required.
 *         Tokens can be invalidated before expiration by using the `/auth/logout` endpoint.
 *   
 *   responses:
 *     UnauthorizedError:
 *       description: |
 *         Access token is missing, invalid, or expired.
 *         This response is returned when:
 *         - No token is provided in the Authorization header
 *         - The token format is invalid
 *         - The token has been blacklisted (after logout)
 *         - The token signature is invalid
 *         - The token has expired
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               error:
 *                 type: string
 *                 description: Descriptive error message
 *                 enum:
 *                   - No token provided
 *                   - Invalid token
 *                   - Token expired
 *                   - Token has been invalidated
 *                   - Unauthorized
 *     ForbiddenError:
 *       description: |
 *         User does not have sufficient permissions to access the resource.
 *         This occurs when the user is authenticated but lacks the required role.
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               error:
 *                 type: string
 *                 example: Forbidden: Insufficient permissions
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { isTokenBlacklisted } from '../services/tokenBlacklistService';
import { academicYearGuard } from './academicYearGuard.middleware';
import prisma from '../../../config/db';

// Get JWT secret from environment variables
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret';

// Roles are resolved from the database on every request, not read from the
// token. The token carries a `role` claim, but it is only ever a snapshot of
// the moment the user signed in, and TOKEN_EXPIRY is 120 days — so a role
// granted, changed or *revoked* after sign-in stayed invisible for up to four
// months. Revocation was the dangerous half: removing someone's BURSAR role
// left their existing token still opening every bursar route until it expired.
//
// It also produced a confusing failure: /auth/me reads roles from the database,
// so the UI showed a user's new roles correctly while every API call 403'd off
// the stale token claim.
//
// Cost is one indexed lookup per request, damped by the short-lived cache
// below. Cache entries are per-process (each PM2 worker keeps its own), so
// worst-case staleness is ROLE_CACHE_TTL_MS regardless of which worker serves
// the request — bounded and uniform, rather than 120 days.
const ROLE_CACHE_TTL_MS = 30_000;

interface CachedIdentity {
    roles: string[];
    status: string;
    expiresAt: number;
}

const roleCache = new Map<number, CachedIdentity>();

/**
 * Drops a user's cached roles so the next request re-reads them. Optional —
 * the TTL already bounds staleness — but callers that change roles can use it
 * to make the change take effect immediately on this process.
 */
export function invalidateUserRoleCache(userId?: number): void {
    if (userId === undefined) roleCache.clear();
    else roleCache.delete(userId);
}

async function loadIdentity(userId: number): Promise<CachedIdentity | null> {
    const now = Date.now();
    const hit = roleCache.get(userId);
    if (hit && hit.expiresAt > now) return hit;

    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { status: true, user_roles: { select: { role: true } } }
    });
    if (!user) {
        // Deleted account holding a still-valid token. Do not cache the miss —
        // an id that does not resolve should keep costing a lookup, not become
        // a sticky negative entry.
        roleCache.delete(userId);
        return null;
    }

    const identity: CachedIdentity = {
        roles: [...new Set(user.user_roles.map(ur => ur.role as string))],
        status: user.status as string,
        expiresAt: now + ROLE_CACHE_TTL_MS
    };
    roleCache.set(userId, identity);
    return identity;
}

/**
 * JWT token payload interface
 * This defines what is stored in the JWT token
 */
export interface JwtPayload {
    id: number;
    email: string;
    role?: [string];
    [key: string]: any;
}

// Add the user property to the Express Request interface directly
// This augmentation approach avoids conflicts with other declarations
declare global {
    namespace Express {
        interface Request {
            user?: JwtPayload;
        }
    }
}

/**
 * Extended Request interface that includes the user property
 * This is used for better code readability and type safety
 */
export type AuthenticatedRequest = Request;

/**
 * Authentication middleware that verifies JWT tokens
 * 
 * This middleware:
 * 1. Extracts the token from the Authorization header
 * 2. Checks if the token is blacklisted (logged out)
 * 3. Verifies the token's signature and expiration
 * 4. Adds the decoded user information to the request object
 * 
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function
 */
export const authenticate = async (req: Request, res: Response, next: NextFunction) => {
    try {
        // Get authorization header
        const authHeader = req.headers.authorization;

        // Check if auth header exists and starts with 'Bearer '
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            res.status(401).json({ error: 'No token provided' });
            return;
        }

        // Extract token from header
        const token = authHeader.split(' ')[1];

        if (!token) {
            res.status(401).json({ error: 'No token provided' });
            return;
        }

        // if(token == 'abcd1234'){
        //     next()
        // }

        // Check if token is blacklisted (logged out)
        if (isTokenBlacklisted(token)) {
            res.status(401).json({ error: 'Token has been invalidated' });
            return;
        }

        // Verify the token
        const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;

        // Resolve the caller's roles from the database rather than trusting the
        // token's `role` claim. See the note beside ROLE_CACHE_TTL_MS above.
        const identity = await loadIdentity(decoded.id);

        if (!identity) {
            res.status(401).json({ error: 'Unauthorized: User or role not found' });
            return;
        }

        // A token outlives a deactivation by up to 120 days, so status has to be
        // checked here too — login already refuses non-ACTIVE accounts, but that
        // only helps people who have not signed in yet.
        if (identity.status !== 'ACTIVE') {
            res.status(401).json({ error: 'User account is not active' });
            return;
        }

        // Add user to request object, with the token's role claim replaced by
        // what the database currently says. Every downstream consumer of
        // req.user.role (authorize, authorizeMinTier, academicYearGuard, the
        // audit trail and the discipline/exam controllers) therefore sees live
        // roles without needing to change.
        (req as AuthenticatedRequest).user = { ...decoded, role: identity.roles as [string] };

        // Gate any provided academic_year_id against current year + role
        return academicYearGuard(req, res, next);
    } catch (error: any) {
        console.error('Authentication error:', error);

        if (error.name === 'JsonWebTokenError') {
            res.status(401).json({ error: 'Invalid token' });
        } else if (error.name === 'TokenExpiredError') {
            res.status(401).json({ error: 'Token expired' });
        } else {
            res.status(500).json({ error: 'Server error during authentication' });
        }
    }
};

/**
 * Middleware for authorization based on user roles
 * 
 * This middleware:
 * 1. Checks if the user is authenticated
 * 2. Verifies if the user's role is included in the list of allowed roles
 * 3. Returns a 403 Forbidden response if the user doesn't have the required role
 * 
 * @param roles - Array of roles allowed to access the route
 * @returns Middleware function that checks if user has allowed role
 * 
 * @example
 * // Allow only teachers and principals to access a route
 * router.get('/grades', authenticate, authorize(['TEACHER', 'PRINCIPAL']), gradesController.getGrades);
 */
export const authorize = (roles: string[]) => {
    return (req: Request, res: Response, next: NextFunction) => {
        const user = (req as AuthenticatedRequest).user;

        if (!user || !user.role) {
            return res.status(401).json({ error: 'Unauthorized: User or role not found' });
        }

        // Tier-1 executives (SUPER_MANAGER, MANAGER) have access to everything.
        // MANAGER is a documented peer of SUPER_MANAGER in the role hierarchy;
        // treating them equivalently here avoids having to list MANAGER on every route.
        if (user.role.includes('SUPER_MANAGER') || user.role.includes('MANAGER')) {
            return next();
        }

        // Check if user has any of the required roles
        if (roles.some(role => user.role!.includes(role))) {
            return next();
        }

        return res.status(403).json({
            error: `Forbidden: Insufficient permissions. Required: ${roles.join(' or ')}, You have: ${user.role.join(', ')}`
        });
    };
};

import { Role } from '@prisma/client';
import { RoleTier, userHasMinTier, getRolesAtOrAbove } from '../../../utils/roleHierarchy';

/**
 * Authorize a route by minimum hierarchy tier. Lower tier number = higher authority.
 * Equivalent to authorize(getRolesAtOrAbove(minTier)) but reads more clearly at the call site.
 *
 * @example
 * router.delete('/students/:id', authenticate, authorizeMinTier(RoleTier.HEAD_OF_SCHOOL), ...);
 */
export const authorizeMinTier = (minTier: RoleTier) => {
    return (req: Request, res: Response, next: NextFunction) => {
        const user = (req as AuthenticatedRequest).user;
        if (!user || !user.role) {
            return res.status(401).json({ error: 'Unauthorized: User or role not found' });
        }
        if (userHasMinTier(user.role as Role[], minTier)) {
            return next();
        }
        return res.status(403).json({
            error: `Forbidden: Insufficient tier. Required tier <= ${minTier}, you have: ${user.role.join(', ')}`,
            allowedRoles: getRolesAtOrAbove(minTier),
        });
    };
};
