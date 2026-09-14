// src/api/v1/controllers/subjectController.ts
import { Request, Response } from 'express';
import * as subjectService from '../services/subjectService';
import { extractPaginationAndFilters } from '../../../utils/pagination';

// Helper function to transform subject data
const transformSubject = (subject: any) => {
    const transformed: any = { ...subject }; // Clone the subject object

    // Rename subject_teachers to teachers
    if (transformed.subject_teachers) {
        transformed.teachers = transformed.subject_teachers.map((st: any) => st.teacher).filter(Boolean); // Extract teacher info and filter nulls if any
        delete transformed.subject_teachers; // Remove original key
    }

    // Rename sub_class_subjects to sub_classes, including coefficient
    if (transformed.sub_class_subjects) {
        transformed.sub_classes = transformed.sub_class_subjects.map((ss: any) => {
            // Check if sub_class exists before spreading
            if (!ss.sub_class) return null;
            return {
                ...ss.sub_class,
                coefficient: ss.coefficient // Add coefficient from the join table
            };
        }).filter(Boolean); // Filter out any null entries if sub_class was missing
        delete transformed.sub_class_subjects; // Remove original key
    }

    return transformed;
};

export const getAllSubjects = async (req: Request, res: Response) => {
    try {
        const allowedFilters = ['name', 'category', 'id', 'include_teachers', 'include_sub_classes'];
        const { paginationOptions, filterOptions } = extractPaginationAndFilters(req.finalQuery, allowedFilters);
        const processedFilters: any = { ...filterOptions };
        const include: any = {};

        // Setup includes based on finalQuery params
        if (filterOptions?.include_teachers === 'true') {
            include.subject_teachers = {
                include: {
                    teacher: true
                }
            };
            delete processedFilters.include_teachers;
        }

        if (filterOptions?.include_sub_classes === 'true') {
            include.sub_class_subjects = {
                include: {
                    sub_class: {
                        include: {
                            class: true
                        }
                    }
                }
            };
            delete processedFilters.include_sub_classes;
        }


        const result = await subjectService.getAllSubjects(paginationOptions, processedFilters, include);


        // Transform the data array within the result
        const transformedData = result.data.map(transformSubject);

        // Return the result object, replacing the original data with transformed data
        res.json({
            success: true,
            ...result, // Spread the pagination fields (total, limit, offset, etc.)
            data: transformedData // Override the data field with transformed data
        });
    } catch (error: any) {
        console.error('Error fetching subjects:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

export const createSubject = async (req: Request, res: Response) => {
    try {
        const newSubject = await subjectService.createSubject(req.body);
        res.status(201).json({
            success: true,
            data: newSubject
        });
    } catch (error: any) {
        console.error('Error creating subject:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

export const assignTeacher = async (req: Request, res: Response) => {
    try {
        const subjectId = parseInt(req.params.id);
        const teacher_id = req.body.teacher_id;

        if (!teacher_id) {
            res.status(400).json({
                success: false,
                error: 'Teacher ID is required'
            });
            return;
        }

        const teacher = await subjectService.assignTeacher(subjectId, {
            teacher_id
        });

        res.status(201).json({
            success: true,
            message: 'Teacher assigned successfully',
            data: {
                teacher
            }
        });
    } catch (error: any) {
        console.error('Error assigning teacher:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

export const linkSubjectToSubClass = async (req: Request, res: Response) => {
    try {
        const subjectId = parseInt(req.params.id);
        const { sub_class_id, coefficient } = req.body;

        if (!sub_class_id || coefficient === undefined || coefficient === null) {
            res.status(400).json({
                success: false,
                error: 'sub_class_id and coefficient are required',
            });
            return;
        }

        const link = await subjectService.linkSubjectToSubClass(subjectId, {
            sub_class_id,
            coefficient,
        });

        res.status(200).json({
            success: true,
            data: link,
        });
    } catch (error: any) {
        console.error('Error linking subject to sub-class:', error);
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
};

export const getSubjectById = async (req: Request, res: Response): Promise<any> => {
    try {
        const subjectId = parseInt(req.params.id);
        // Service function fetches includes by default
        const subject = await subjectService.getSubjectById(subjectId);

        if (!subject) {
            return res.status(404).json({
                success: false,
                error: 'Subject not found'
            });
        }

        // Transform the single subject data
        const transformedSubject = transformSubject(subject);

        res.json({
            success: true,
            data: transformedSubject
        });
    } catch (error: any) {
        console.error('Error fetching subject:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

export const updateSubject = async (req: Request, res: Response): Promise<any> => {
    try {
        const subjectId = parseInt(req.params.id);
        const updatedData = req.body;

        // Check if subject exists
        const existingSubject = await subjectService.getSubjectById(subjectId);
        if (!existingSubject) {
            return res.status(404).json({
                success: false,
                error: 'Subject not found'
            });
        }

        // Update the subject
        const updatedSubject = await subjectService.updateSubject(subjectId, updatedData);

        res.json({
            success: true,
            message: 'Subject updated successfully',
            data: updatedSubject
        });
    } catch (error: any) {
        console.error('Error updating subject:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

export const deleteSubject = async (req: Request, res: Response): Promise<any> => {
    try {
        const subjectId = parseInt(req.params.id);

        // Check if subject exists
        const existingSubject = await subjectService.getSubjectById(subjectId);
        if (!existingSubject) {
            return res.status(404).json({
                success: false,
                error: 'Subject not found'
            });
        }

        // Delete the subject
        await subjectService.deleteSubject(subjectId);

        res.json({
            success: true,
            message: 'Subject deleted successfully'
        });
    } catch (error: any) {
        console.error('Error deleting subject:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

/**
 * Unlink a subject from a subclass
 * @param req Request object containing subjectId and subClassId
 * @param res Response object
 */
export const unlinkSubjectFromSubClass = async (req: Request, res: Response): Promise<void> => {
    try {
        const subjectId = parseInt(req.params.subjectId);
        const subClassId = parseInt(req.params.subClassId);

        // Validate inputs
        if (isNaN(subjectId) || isNaN(subClassId)) {
            res.status(400).json({
                success: false,
                error: 'Invalid subject ID or subclass ID'
            });
            return;
        }

        // Call service to unlink subject from sub_class
        await subjectService.unlinkSubjectFromSubClass(subjectId, subClassId);

        res.json({
            success: true,
            message: `Subject ID ${subjectId} successfully unlinked from subclass ID ${subClassId}`
        });
    } catch (error: any) {
        console.error('Error unlinking subject from subclass:', error);

        if (error.message.includes('not linked')) {
            res.status(404).json({
                success: false,
                error: error.message
            });
            return;
        }
        if (error.code === 'P2025') { // Prisma error code for record not found
            res.status(404).json({
                success: false,
                error: 'Subject-subclass link not found'
            });
            return;
        }

        res.status(500).json({
            success: false,
            error: `Failed to unlink subject from subclass: ${error.message}`
        });
    }
};

/**
 * Assign a subject to all sub_classes of a class
 * @param req Request object containing class_id, subject_id, coefficient
 * @param res Response object
 */
export const assignSubjectToClass = async (req: Request, res: Response): Promise<void> => {
    try {
        const classId = parseInt(req.params.classId);
        const subjectId = parseInt(req.params.subjectId);
        const { coefficient } = req.body;

        // Validate inputs
        if (isNaN(classId) || isNaN(subjectId)) {
            res.status(400).json({
                success: false,
                error: 'Invalid class ID or subject ID'
            });
            return;
        }

        if (!coefficient) {
            res.status(400).json({
                success: false,
                error: 'Coefficient are required'
            });
            return;
        }

        // Call service to assign subject to all sub_classes
        const result = await subjectService.assignSubjectToClass(
            classId,
            subjectId,
            {
                coefficient: parseFloat(coefficient)
            }
        );

        res.status(201).json({
            success: true,
            message: `Subject successfully assigned to all sub_classes of class ID ${classId}`,
            data: result
        });
    } catch (error: any) {
        console.error('Error assigning subject to class:', error);

        if (error.message.includes('No sub_classes found') ||
            error.message.includes('Subject with ID') ||
            error.message.includes('Teacher with ID')) {
            res.status(404).json({
                success: false,
                error: error.message
            });
            return;
        }

        res.status(500).json({
            success: false,
            error: `Failed to assign subject to class: ${error.message}`
        });
    }
};
