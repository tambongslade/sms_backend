// src/api/v1/controllers/authController.ts
import { Request, Response } from 'express';
import * as authService from '../services/authService';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { blacklistToken } from '../services/tokenBlacklistService';

/**
 * Handle user login
 * 
 * @param req - Express request object containing email/matricule and password in the body
 * @param res - Express response object
 */
export const login = async (req: Request, res: Response) => {
    try {
        const { email, matricule, phone, identifier, password } = req.body;

        // `identifier` is a single-input convenience: contains @ → email;
        // starts with letters (like "ST123") → matricule; digits only → phone.
        let creds: { email?: string; matricule?: string; phone?: string; password: string } = {
            email, matricule, phone, password,
        };
        if (identifier && !email && !matricule && !phone) {
            const trimmed = String(identifier).trim();
            if (trimmed.includes('@')) creds.email = trimmed;
            else if (/^\+?[\d\s-]+$/.test(trimmed)) creds.phone = trimmed;
            else creds.matricule = trimmed;
        }

        if ((!creds.email && !creds.matricule && !creds.phone) || !password) {
            return res.status(400).json({
                success: false,
                error: 'Identifier (email/phone/matricule) and password are required',
            });
        }

        const result = await authService.login(creds);

        res.json({
            success: true,
            data: result
        });
    } catch (error: any) {
        console.error('Login error:', error);
        res.status(401).json({
            success: false,
            error: error.message
        });
    }
};

/**
 * Register a new user
 * 
 * @param req - Express request object containing user details in the body
 * @param res - Express response object
 */
export const register = async (req: Request, res: Response) => {
    try {
        const newUser = await authService.register(req.body);
        res.status(201).json({
            success: true,
            message: 'User registered successfully',
            data: newUser
        });
    } catch (error: any) {
        console.error('Register error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

/**
 * Get the profile of the currently authenticated user
 * 
 * @param req - Express request object with authenticated user info
 * @param res - Express response object
 */
export const getProfile = async (req: Request, res: Response) => {
    try {
        const authReq = req as AuthenticatedRequest;
        const userId = authReq.user?.id;

        if (!userId) {
            res.status(401).json({
                success: false,
                error: 'Unauthorized'
            });
            return;
        }

        const user = await authService.getProfile(userId);
        if (!user) {
            res.status(404).json({
                success: false,
                error: 'User not found'
            });
            return;
        }

        res.json({
            success: true,
            data: user
        });
    } catch (error: any) {
        console.error('Get profile error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

/**
 * Change the authenticated user's password.
 * Body: { currentPassword, newPassword }
 */
export const changePassword = async (req: Request, res: Response) => {
    try {
        const authReq = req as AuthenticatedRequest;
        const userId = authReq.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }

        const { current_password, new_password } = req.body as {
            current_password?: string;
            new_password?: string;
        };

        if (!new_password) {
            return res.status(400).json({
                success: false,
                error: 'newPassword is required',
            });
        }

        if (typeof new_password !== 'string' || new_password.length < 8) {
            return res.status(400).json({
                success: false,
                error: 'newPassword must be at least 8 characters long',
            });
        }

        await authService.changePassword(userId, current_password, new_password);

        // Invalidate the current token so the user must sign in again with the new password.
        const authHeader = req.headers.authorization;
        if (authHeader?.startsWith('Bearer ')) {
            blacklistToken(authHeader.split(' ')[1]);
        }

        res.json({
            success: true,
            message: 'Password changed successfully. Please sign in again.',
        });
    } catch (error: any) {
        console.error('Change password error:', error);
        const status =
            error.message === 'Current password is incorrect' ? 400 :
            error.message === 'Current password is required' ? 400 :
            error.message === 'New password must be different from the current password' ? 400 :
            error.message === 'User not found' ? 404 : 500;
        res.status(status).json({ success: false, error: error.message });
    }
};

/**
 * Handle user logout - invalidates the current token
 *
 * @param req - Express request object with authenticated user info
 * @param res - Express response object
 */
export const logout = (req: Request, res: Response) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            res.status(400).json({
                success: false,
                error: 'No token provided'
            });
            return;
        }

        const token = authHeader.split(' ')[1];
        blacklistToken(token);

        res.json({
            success: true,
            message: 'Logged out successfully'
        });
    } catch (error: any) {
        console.error('Logout error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Error during logout'
        });
    }
};
