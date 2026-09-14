import { Request, Response } from 'express';
import * as bursarService from '../services/bursarService';
import { Gender } from '@prisma/client';

/**
 * Create student with automatic parent account creation
 * POST /api/v1/bursar/create-parent-with-student
 */
export const createStudentWithParent = async (req: Request, res: Response): Promise<void> => {
    try {
        const {
            student_name: studentName,
            student_nom: studentNom,
            student_prenom: studentPrenom,
            date_of_birth: dateOfBirth,
            place_of_birth: placeOfBirth,
            gender: gender,
            residence: residence,
            former_school: formerSchool,
            class_id: classId,
            is_new_student: isNewStudent,
            ream_of_paper_collected: reamOfPaperCollected,
            academic_year_id: academicYearId,
            parents: parentsArr, // New: array of up to 2 parent contacts
            parent_name: parentName,
            parent_phone: parentPhone,
            parent_phone_is_whatsapp: parentPhoneIsWhatsapp,
            parent_whatsapp: parentWhatsapp,
            parent_address: parentAddress,
            relationship: relationship
        } = req.body;

        // Accept either (nom + prenom) or legacy student_name
        const hasSplitName = !!(studentNom && studentPrenom);
        const hasLegacyName = !!studentName;
        if (!hasSplitName && !hasLegacyName) {
            res.status(400).json({
                success: false,
                error: 'Provide both studentNom (family name) and studentPrenom (given name).'
            });
            return;
        }

        // Validate required fields (student side)
        if (!dateOfBirth || !placeOfBirth || !gender || !residence || !classId) {
            res.status(400).json({
                success: false,
                error: 'Missing required fields: dateOfBirth, placeOfBirth, gender, residence, classId'
            });
            return;
        }

        // Validate parents array if provided, otherwise require legacy single-parent fields.
        let parents: any[] | undefined;
        if (Array.isArray(parentsArr) && parentsArr.length > 0) {
            if (parentsArr.length > 2) {
                res.status(400).json({ success: false, error: 'At most two parent contacts allowed.' });
                return;
            }
            for (let i = 0; i < parentsArr.length; i++) {
                const p = parentsArr[i];
                if (!p?.name || !p?.phone) {
                    res.status(400).json({
                        success: false,
                        error: `Parent #${i + 1} requires name and phone.`
                    });
                    return;
                }
                if (p.relationship && !['FATHER', 'MOTHER', 'SIBLING', 'GUARDIAN'].includes(String(p.relationship).toUpperCase())) {
                    res.status(400).json({
                        success: false,
                        error: `Parent #${i + 1}: invalid relationship. Must be FATHER, MOTHER, SIBLING, or GUARDIAN.`
                    });
                    return;
                }
            }
            parents = parentsArr.map(p => ({
                name: p.name,
                phone: p.phone,
                phone_is_whatsapp: p.phoneIsWhatsapp !== undefined ? Boolean(p.phoneIsWhatsapp) : (p.phone_is_whatsapp !== undefined ? Boolean(p.phone_is_whatsapp) : undefined),
                whatsapp: p.whatsapp,
                address: p.address,
                relationship: p.relationship
            }));
        } else {
            if (!parentName || !parentPhone) {
                res.status(400).json({
                    success: false,
                    error: 'At least one parent contact is required (parents[] or parent_name/parent_phone).'
                });
                return;
            }
            if (relationship && !['FATHER', 'MOTHER', 'SIBLING', 'GUARDIAN'].includes(String(relationship).toUpperCase())) {
                res.status(400).json({
                    success: false,
                    error: 'Invalid relationship. Must be FATHER, MOTHER, SIBLING, or GUARDIAN.'
                });
                return;
            }
        }

        const result = await bursarService.createStudentWithParent({
            student_name: studentName,
            student_nom: studentNom,
            student_prenom: studentPrenom,
            date_of_birth: dateOfBirth,
            place_of_birth: placeOfBirth,
            gender: gender.toUpperCase() === 'MALE' ? Gender.Male : Gender.Female,
            residence,
            former_school: formerSchool,
            class_id: parseInt(classId),
            is_new_student: isNewStudent,
            ream_of_paper_collected: reamOfPaperCollected !== undefined ? Boolean(reamOfPaperCollected) : undefined,
            academic_year_id: academicYearId ? parseInt(academicYearId) : undefined,
            parents: parents,
            parent_name: parentName,
            parent_phone: parentPhone,
            parent_phone_is_whatsapp: parentPhoneIsWhatsapp !== undefined ? Boolean(parentPhoneIsWhatsapp) : undefined,
            parent_whatsapp: parentWhatsapp,
            parent_address: parentAddress,
            relationship: relationship
        });

        res.status(201).json({
            success: true,
            message: 'Student registered successfully with parent account created',
            data: result
        });
    } catch (error: any) {
        console.error('Error creating student with parent:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

/**
 * Get available parents for selection/linking
 * GET /api/v1/bursar/available-parents
 */
export const getAvailableParents = async (req: Request, res: Response): Promise<void> => {
    try {
        const { search, limit } = req.query;

        const parents = await bursarService.getAvailableParents(
            search as string,
            limit ? parseInt(limit as string) : 20
        );

        res.status(200).json({
            success: true,
            message: 'Available parents retrieved successfully',
            data: parents,
            count: parents.length
        });
    } catch (error: any) {
        console.error('Error fetching available parents:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

/**
 * Create a brand-new parent account and link it to an existing student.
 * POST /api/v1/bursar/create-parent-for-student
 */
export const createParentForStudent = async (req: Request, res: Response): Promise<void> => {
    try {
        const {
            studentId,
            name,
            phone,
            address,
            phoneIsWhatsapp,
            whatsapp,
            relationship,
            academicYearId,
        } = req.body;

        if (!studentId || !name || !phone) {
            res.status(400).json({
                success: false,
                error: 'Missing required fields: studentId, name, phone',
            });
            return;
        }

        if (
            relationship &&
            !['FATHER', 'MOTHER', 'SIBLING', 'GUARDIAN'].includes(String(relationship).toUpperCase())
        ) {
            res.status(400).json({
                success: false,
                error: 'Invalid relationship. Must be FATHER, MOTHER, SIBLING, or GUARDIAN.',
            });
            return;
        }

        const result = await bursarService.createParentForStudent({
            student_id: parseInt(studentId),
            name,
            phone,
            address,
            phone_is_whatsapp: !!phoneIsWhatsapp,
            whatsapp,
            relationship,
            academic_year_id: academicYearId ? parseInt(academicYearId) : undefined,
        });

        res.status(201).json({
            success: true,
            message: 'Parent created and linked to student successfully',
            data: result,
        });
    } catch (error: any) {
        console.error('Error creating parent for student:', error);
        const message = error?.message || 'Failed to create parent for student';
        // Duplicate phone -> unique constraint on User.phone/email
        const status = /already|unique|duplicate/i.test(message) ? 409 : 500;
        res.status(status).json({ success: false, error: message });
    }
};

/**
 * Link existing parent to a student
 * POST /api/v1/bursar/link-existing-parent
 */
export const linkExistingParent = async (req: Request, res: Response): Promise<void> => {
    try {
        const {
            studentId,
            parentId,
            relationship
        } = req.body;

        // Validate required fields
        if (!studentId || !parentId) {
            res.status(400).json({
                success: false,
                error: 'Missing required fields: studentId, parentId'
            });
            return;
        }

        // Validate optional relationship enum
        if (relationship && !['FATHER', 'MOTHER', 'SIBLING', 'GUARDIAN'].includes(String(relationship).toUpperCase())) {
            res.status(400).json({
                success: false,
                error: 'Invalid relationship. Must be FATHER, MOTHER, SIBLING, or GUARDIAN.'
            });
            return;
        }

        const result = await bursarService.linkExistingParent({
            student_id: parseInt(studentId),
            parent_id: parseInt(parentId),
            relationship: relationship
        });

        res.status(201).json({
            success: true,
            message: result.message,
            data: result
        });
    } catch (error: any) {
        console.error('Error linking existing parent:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

/**
 * Get bursar dashboard with financial overview and statistics
 * GET /api/v1/bursar/dashboard
 */
export const getBursarDashboard = async (req: Request, res: Response): Promise<void> => {
    try {
        const { academicYearId } = req.query;

        const dashboard = await bursarService.getBursarDashboard(
            academicYearId ? parseInt(academicYearId as string) : undefined
        );

        res.status(200).json({
            success: true,
            message: 'Bursar dashboard data retrieved successfully',
            data: dashboard
        });
    } catch (error: any) {
        console.error('Error fetching bursar dashboard:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

/**
 * Get collection analytics for bursar (monthly trends, payment methods)
 * GET /api/v1/bursar/collection-analytics
 */
export const getCollectionAnalytics = async (req: Request, res: Response): Promise<void> => {
    try {
        const { academicYearId, startDate, endDate } = req.query;

        // This is a placeholder for future implementation
        // For now, return basic structure
        const analytics = {
            monthly_trends: [],
            payment_methods: [],
            collection_rate: 0,
            target_vs_actual: {
                target: 0,
                actual: 0,
                variance: 0
            }
        };

        res.status(200).json({
            success: true,
            message: 'Collection analytics retrieved successfully',
            data: analytics
        });
    } catch (error: any) {
        console.error('Error fetching collection analytics:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

/**
 * Get payment trends analysis
 * GET /api/v1/bursar/payment-trends
 */
export const getPaymentTrends = async (req: Request, res: Response): Promise<void> => {
    try {
        const { academicYearId, period } = req.query;

        // This is a placeholder for future implementation
        const trends = {
            daily_collections: [],
            weekly_summary: [],
            payment_methods_breakdown: [],
            peak_collection_days: []
        };

        res.status(200).json({
            success: true,
            message: 'Payment trends retrieved successfully',
            data: trends
        });
    } catch (error: any) {
        console.error('Error fetching payment trends:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

/**
 * Get defaulters report (students with outstanding balances)
 * GET /api/v1/bursar/defaulters-report
 */
export const getDefaultersReport = async (req: Request, res: Response): Promise<void> => {
    try {
        const {
            academicYearId,
            minimumAmount,
            classId,
            subClassId,
            includeDetails
        } = req.query as Record<string, string | undefined>;

        const toNumber = (v: string | undefined) => {
            if (v === undefined || v === '') return undefined;
            const n = Number(v);
            return Number.isNaN(n) ? undefined : n;
        };

        const defaulters = await bursarService.getDefaultersReport({
            academicYearId: toNumber(academicYearId),
            minimumAmount: toNumber(minimumAmount),
            classId: toNumber(classId),
            subClassId: toNumber(subClassId),
            includeDetails: includeDetails === 'true'
        });

        res.status(200).json({
            success: true,
            message: 'Defaulters report retrieved successfully',
            data: defaulters
        });
    } catch (error: any) {
        console.error('Error fetching defaulters report:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

/**
 * Reset a parent's password back to the default `password123`.
 * POST /api/v1/bursar/parents/:parentId/reset-password
 */
export const resetParentPassword = async (req: Request, res: Response): Promise<void> => {
    try {
        const parentId = parseInt(req.params.parentId, 10);
        if (Number.isNaN(parentId)) {
            res.status(400).json({
                success: false,
                error: 'Invalid parentId parameter'
            });
            return;
        }

        const actorId = (req as any).user?.id;

        const result = await bursarService.resetParentPassword(parentId, actorId);

        res.status(200).json({
            success: true,
            data: result
        });
    } catch (error: any) {
        console.error('Error resetting parent password:', error);
        const statusCode = error?.statusCode ?? 500;
        res.status(statusCode).json({
            success: false,
            error: error.message
        });
    }
};
