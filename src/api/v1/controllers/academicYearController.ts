// src/api/v1/controllers/academicYearController.ts
import { Request, Response } from 'express';
import * as academicYearService from '../services/academicYearService';

export const getAllAcademicYears = async (req: Request, res: Response): Promise<void> => {
    try {
        const years = await academicYearService.getAllAcademicYears();

        // Response will be automatically converted to camelCase by middleware
        res.json({
            success: true,
            data: years
        });
    } catch (error: any) {
        console.error('Error fetching academic years:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

export const createAcademicYear = async (req: Request, res: Response): Promise<void> => {
    try {
        // No need to convert - middleware already converts to snake_case
        const { start_date, end_date, name, terms } = req.body;

        if (!start_date || !end_date || !name) {
            res.status(400).json({
                success: false,
                error: 'Start date, end date, and name are required'
            });
            return;
        }

        // Validate terms if provided
        if (terms && Array.isArray(terms)) {
            for (const term of terms) {
                if (!term.name || !term.start_date || !term.end_date) {
                    res.status(400).json({
                        success: false,
                        error: 'Each term must have a name, start date, and end date'
                    });
                    return;
                }
                if (term.is_holiday && (!Array.isArray(term.class_ids) || term.class_ids.length === 0)) {
                    res.status(400).json({
                        success: false,
                        error: 'Holiday terms must specify at least one class in classIds'
                    });
                    return;
                }
                if (term.class_ids !== undefined && !Array.isArray(term.class_ids)) {
                    res.status(400).json({
                        success: false,
                        error: 'classIds must be an array of class IDs'
                    });
                    return;
                }
            }
        }

        const newYear = await academicYearService.createAcademicYear({
            start_date,
            end_date,
            name,
            terms
        });

        // Response will be automatically converted to camelCase by middleware
        res.status(201).json({
            success: true,
            data: newYear
        });
    } catch (error: any) {
        console.error('Error creating academic year:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

export const getAcademicYearById = async (req: Request, res: Response): Promise<void> => {
    try {
        const id = parseInt(req.params.id);

        // Validate that the ID is a valid number
        if (isNaN(id)) {
            res.status(400).json({
                success: false,
                error: 'Invalid academic year ID format'
            });
            return;
        }

        const year = await academicYearService.getAcademicYearById(id);
        if (!year) {
            res.status(404).json({
                success: false,
                error: 'Academic year not found'
            });
            return;
        }

        // Response will be automatically converted to camelCase by middleware
        res.status(200).json({
            success: true,
            data: year
        });
    } catch (error: any) {
        console.error('Error fetching academic year:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

export const updateAcademicYear = async (req: Request, res: Response): Promise<void> => {
    try {
        const id = parseInt(req.params.id);

        // Validate that the ID is a valid number
        if (isNaN(id)) {
            res.status(400).json({
                success: false,
                error: 'Invalid academic year ID format'
            });
            return;
        }

        const { start_date, end_date } = req.body;
        //TODO: Update other properties of academic year like year name, term properties and so o

        const updatedYear = await academicYearService.updateAcademicYear(id, {
            start_date,
            end_date
        });

        // Response will be automatically converted to camelCase by middleware
        res.json({
            success: true,
            data: updatedYear
        });
    } catch (error: any) {
        console.error('Error updating academic year:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

export const deleteAcademicYear = async (req: Request, res: Response): Promise<void> => {
    try {
        const id = parseInt(req.params.id);

        // Validate that the ID is a valid number
        if (isNaN(id)) {
            res.status(400).json({
                success: false,
                error: 'Invalid academic year ID format'
            });
            return;
        }

        // Check if academic year exists
        const existingYear = await academicYearService.getAcademicYearById(id);
        if (!existingYear) {
            res.status(404).json({
                success: false,
                error: 'Academic year not found'
            });
            return;
        }

        await academicYearService.deleteAcademicYear(id);
        res.json({
            success: true,
            message: 'Academic year deleted successfully'
        });
    } catch (error: any) {
        console.error('Error deleting academic year:', error);

        // Check if this is a dependency constraint error
        if (error.message && error.message.includes('Cannot delete academic year. It is referenced by:')) {
            res.status(409).json({
                success: false,
                error: error.message
            });
            return;
        }

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

export const addTerm = async (req: Request, res: Response): Promise<void> => {
    try {
        const yearId = parseInt(req.params.id);

        // Validate that the ID is a valid number
        if (isNaN(yearId)) {
            res.status(400).json({
                success: false,
                error: 'Invalid academic year ID format'
            });
            return;
        }

        const { name, start_date, end_date, fee_deadline } = req.body;

        // Validate required fields
        if (!name || !start_date || !end_date) {
            res.status(400).json({
                success: false,
                error: 'Term name, start date, and end date are required'
            });
            return;
        }

        // Check if the academic year exists
        const year = await academicYearService.getAcademicYearById(yearId);
        if (!year) {
            res.status(404).json({
                success: false,
                error: 'Academic year not found'
            });
            return;
        }

        // Add term to academic year
        const term = await academicYearService.addTermToYear(yearId, {
            name,
            start_date: new Date(start_date),
            end_date: new Date(end_date),
            fee_deadline: fee_deadline ? new Date(fee_deadline) : undefined
        });

        // Response will be automatically converted to camelCase by middleware
        res.status(201).json({
            success: true,
            message: `Term "${name}" added to academic year ${year.start_date}`,
            data: term
        });
    } catch (error: any) {
        console.error('Error adding term to academic year:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

export const getTerms = async (req: Request, res: Response): Promise<void> => {
    try {
        const yearId = parseInt(req.params.id);

        // Validate that the ID is a valid number
        if (isNaN(yearId)) {
            res.status(400).json({
                success: false,
                error: 'Invalid academic year ID format'
            });
            return;
        }

        // Check if the academic year exists
        const year = await academicYearService.getAcademicYearById(yearId);
        if (!year) {
            res.status(404).json({
                success: false,
                error: 'Academic year not found'
            });
            return;
        }

        const terms = await academicYearService.getTermsByAcademicYearId(yearId);

        res.status(200).json({
            success: true,
            data: terms
        });
    } catch (error: any) {
        console.error('Error getting terms:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

export const getCurrentAcademicYear = async (req: Request, res: Response): Promise<void> => {
    try {
        const currentYear = await academicYearService.getCurrentYear();

        if (!currentYear) {
            res.status(404).json({
                success: false,
                error: 'No current academic year found'
            });
            return;
        }

        // Response will be automatically converted to camelCase by middleware
        res.json({
            success: true,
            data: currentYear
        });
    } catch (error: any) {
        console.error('Error fetching current academic year:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

export const setCurrentAcademicYear = async (req: Request, res: Response): Promise<void> => {
    try {
        const id = parseInt(req.params.id);

        // Validate that the ID is a valid number
        if (isNaN(id)) {
            res.status(400).json({
                success: false,
                error: 'Invalid academic year ID format'
            });
            return;
        }

        // Check if academic year exists
        const existingYear = await academicYearService.getAcademicYearById(id);
        if (!existingYear) {
            res.status(404).json({
                success: false,
                error: 'Academic year not found'
            });
            return;
        }

        const updatedYear = await academicYearService.setCurrentAcademicYear(id);

        res.json({
            success: true,
            message: 'Academic year set as current successfully',
            data: updatedYear
        });
    } catch (error: any) {
        console.error('Error setting current academic year:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

/**
 * Get academic years available for a specific role
 */
export const getAvailableAcademicYearsForRole = async (req: Request, res: Response): Promise<void> => {
    try {
        const role = req.query.role as string;

        // Validate role parameter
        if (!role) {
            res.status(400).json({
                success: false,
                error: 'Role parameter is required'
            });
            return;
        }

        // For global roles (SUPER_MANAGER, MANAGER — Tier 1 executives), return all academic years.
        // For year-specific roles, return academic years where the user has access.
        const globalRoles = ['SUPER_MANAGER', 'MANAGER'];

        let academicYears;

        // Get the authenticated user ID from the request
        const userId = (req as any).user?.id;

        if (!userId) {
            res.status(401).json({
                success: false,
                error: 'User not authenticated'
            });
            return;
        }

        if (globalRoles.includes(role)) {
            // Global roles can access all academic years
            academicYears = await academicYearService.getAllAcademicYears();
        } else {
            // For year-specific roles, return only academic years where THIS USER has that role
            academicYears = await academicYearService.getAcademicYearsForUserRole(userId, role);
        }

        // Get current academic year for reference
        const currentYear = await academicYearService.getCurrentYear();

        // Format response with additional context
        const responseData = {
            academicYears: academicYears.map(year => ({
                ...year,
                studentCount: year._count?.enrollments || 0,
                termCount: year.terms?.length || 0,
                status: year.is_current ? 'ACTIVE' :
                    new Date(year.end_date) < new Date() ? 'COMPLETED' : 'UPCOMING'
            })),
            currentAcademicYearId: currentYear?.id || null,
            userHasAccessTo: academicYears.map(year => year.id)
        };

        res.status(200).json({
            success: true,
            data: responseData
        });
    } catch (error: any) {
        console.error('Error fetching available academic years for role:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};
