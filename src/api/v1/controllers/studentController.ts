// src/api/v1/controllers/studentController.ts
import { Request, Response } from 'express';
import prisma from '../../../config/db';
import * as studentService from '../services/studentService';
import * as feeService from '../services/feeService';
import * as controlFeeService from '../services/controlFeeService';
import * as examService from '../services/examService';
import * as attendanceService from '../services/attendanceService';
import * as disciplineService from '../services/disciplineService';
import { extractPaginationAndFilters } from '../../../utils/pagination';
import { transformUser } from './userController'; // Assuming transformUser is exported from userController
import { User, ParentStudent } from '@prisma/client'; // Import User and ParentStudent
import { getStudentStatus, getStudentsWithStatus } from '../../../utils/studentStatus'; // Import student status utilities
import { getAcademicYearId } from '../../../utils/academicYear'; // Import academic year utilities
import upload, { PhotoType, getFileUrl, deletePhotoFile, isValidPhotoFilename } from '../../../utils/fileUpload';
import { saveFileMetadata } from '../services/fileService';

// Define an interface for ParentStudent with the parent relation included
interface ParentStudentWithParent extends ParentStudent {
    parent?: User | null; // Or your specific User type if different
}

export const getAllStudents = async (req: Request, res: Response) => {
    try {
        // Define allowed filters for students using snake_case
        // enrollmentStatus is handled separately, not as a direct Prisma filter here
        const allowedFilters = ['name', 'gender', 'matricule', 'id', 'sub_class_id', 'academic_year_id'];
        // // Add enrollmentStatus as an allowed finalQuery param (though handled specially)
        // const allowedParams = [...allowedFilters, 'sort_by', 'sort_order', 'academic_year_id', 'enrollment_status'];


        // Extract pagination and filter parameters from the request
        const { paginationOptions, filterOptions } = extractPaginationAndFilters(req.finalQuery, allowedFilters);




        // Extract enrollmentStatus separately
        const enrollment_status_input = req.finalQuery.status as string | undefined; // e.g., 'enrolled', 'not_enrolled', 'all'
        let valid_enrollment_status: 'enrolled' | 'not_enrolled' | 'all' | undefined = 'all';

        if (enrollment_status_input) {
            if (['enrolled', 'not_enrolled', 'all'].includes(enrollment_status_input.toLocaleLowerCase())) {
                valid_enrollment_status = enrollment_status_input.toLocaleLowerCase() as 'enrolled' | 'not_enrolled' | 'all';
            } else {
                // Optionally handle invalid status, e.g., return 400 error or log warning
                console.warn(`Invalid enrollment_status provided: '${enrollment_status_input}'. Defaulting to 'all'.`);
                // Or: return res.status(400).json({ success: false, error: "Invalid enrollmentStatus. Must be one of: enrolled, not_enrolled, all" });
            }
        }


        const currentAcademicYearId = await getAcademicYearId();
        // Always fetch students with their current enrollment info to handle filters like sub_class_id
        // Get academic year from finalQuery - middleware handles conversion
        const academic_year_id = req.finalQuery.academic_year_id ?
            parseInt(req.finalQuery.academic_year_id as string) : currentAcademicYearId;

        if (!academic_year_id) {
            res.status(400).json({
                success: false,
                error: 'Academic year ID is required'
            });
            return;
        }

        // Call the service function that handles enrollment-based filtering
        const result = await studentService.getAllStudentsWithCurrentEnrollment(
            academic_year_id,
            paginationOptions,
            filterOptions, // Pass the filters extracted (including sub_class_id)
            valid_enrollment_status, // Pass the validated enrollment status filter
            (req as any).teacherSubClassIds // Pass teacher's accessible subclass IDs if present
        );

        res.json({
            success: true,
            ...result
        });
    } catch (error: any) {
        console.error('Error fetching students:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

export const createStudent = async (req: Request, res: Response) => {
    try {
        // Use the body directly - middleware handles conversion
        const studentData = req.body;

        // Require nom + prenom (preferred) OR legacy single `name`
        const hasSplitName = !!(studentData.nom && studentData.prenom);
        const hasLegacyName = !!studentData.name;
        if (!hasSplitName && !hasLegacyName) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: provide both nom (family name) and prenom (given name).'
            });
        }

        // Validate other required fields
        const requiredFields = ['date_of_birth', 'place_of_birth', 'gender', 'residence'];
        const missingFields = requiredFields.filter(field => !studentData[field]);

        if (missingFields.length > 0) {
            return res.status(400).json({
                success: false,
                error: `Missing required fields: ${missingFields.join(', ')}`
            });
        }

        // Validate gender
        const validGenders = ['MALE', 'FEMALE', 'OTHER'];
        if (!validGenders.includes(studentData.gender?.toUpperCase())) {
            return res.status(400).json({
                success: false,
                error: 'Invalid gender. Must be MALE, FEMALE, or OTHER'
            });
        }

        // Normalize gender to uppercase
        studentData.gender = studentData.gender.toUpperCase();

        const newStudent = await studentService.createStudent(studentData);

        res.status(201).json({
            success: true,
            data: newStudent
        });
    } catch (error: any) {
        console.error('Error creating student:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

export const getStudentById = async (req: Request, res: Response): Promise<any> => {
    try {
        const id = parseInt(req.params.id);

        // Validate that the ID is a valid number
        if (isNaN(id)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid student ID format'
            });
        }

        const student = await studentService.getStudentById(id);
        if (!student) {
            return res.status(404).json({
                success: false,
                error: 'Student not found'
            });
        }
        res.json({
            success: true,
            data: student
        });
    } catch (error: any) {
        console.error('Error fetching student:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

export const getStudentFullProfile = async (req: Request, res: Response): Promise<any> => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) {
            return res.status(400).json({ success: false, error: 'Invalid student ID format' });
        }

        const academicYearId = req.finalQuery?.academic_year_id
            ? parseInt(req.finalQuery.academic_year_id as string)
            : undefined;

        const yearId = academicYearId || await getAcademicYearId() || undefined;

        const student = await studentService.getStudentFullProfileBase(id);
        if (!student) {
            return res.status(404).json({ success: false, error: 'Student not found' });
        }

        const [fees, controlFees, marksResult, attendanceSummary, discipline] = await Promise.allSettled([
            feeService.getStudentFees(id, yearId),
            controlFeeService.getStudentControlFees(id, yearId),
            examService.getAllMarks(
                { page: 1, limit: 1000 },
                { student_id: id.toString(), include_subject: 'true', include_exam_sequence: 'true' },
                yearId
            ),
            attendanceService.getStudentAttendanceSummary({ student_id: id, academic_year_id: yearId }),
            disciplineService.getDisciplineHistory(id),
        ]);

        const enrollments = (student as any).enrollments ?? [];
        const currentEnrollment = enrollments.find((e: any) => e.academic_year_id === yearId) ?? null;

        const enrichEnrollmentPhoto = (e: any) => ({
            ...e,
            photo_url: e?.photo ? getFileUrl(req, e.photo, PhotoType.STUDENT) : null,
        });

        res.json({
            success: true,
            data: {
                ...student,
                enrollments: enrollments.map(enrichEnrollmentPhoto),
                current_enrollment: currentEnrollment ? enrichEnrollmentPhoto(currentEnrollment) : null,
                fees: fees.status === 'fulfilled' ? fees.value : [],
                control_fees: controlFees.status === 'fulfilled' ? controlFees.value : [],
                marks: marksResult.status === 'fulfilled' ? marksResult.value.data : [],
                attendance_summary: attendanceSummary.status === 'fulfilled' ? attendanceSummary.value : null,
                discipline: discipline.status === 'fulfilled' ? discipline.value : [],
            }
        });
    } catch (error: any) {
        console.error('Error fetching student full profile:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

export const updateStudent = async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        const updateData = req.body;

        // Validate that the ID is a valid number
        if (isNaN(id)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid student ID format'
            });
        }

        const updatedStudent = await studentService.updateStudent(id, updateData);
        res.json({
            success: true,
            data: updatedStudent
        });
    } catch (error: any) {
        console.error('Error updating student:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

interface MulterRequest extends Request {
    file?: Express.Multer.File;
}

/**
 * Upload student photo for enrollment
 * @route POST /api/v1/students/:id/photo
 */
export const uploadStudentPhoto = async (req: MulterRequest, res: Response): Promise<void> => {
    try {
        const studentId = parseInt(req.params.id);
        if (isNaN(studentId)) {
            res.status(400).json({
                success: false,
                error: 'Invalid student ID format'
            });
            return;
        }

        // Verify student exists
        const student = await studentService.getStudentById(studentId);
        if (!student) {
            res.status(404).json({
                success: false,
                error: 'Student not found'
            });
            return;
        }

        if (!req.file) {
            res.status(400).json({
                success: false,
                error: 'No photo file uploaded'
            });
            return;
        }

        // Save file metadata and get file information
        const fileData = await saveFileMetadata(req, req.file);

        res.status(201).json({
            success: true,
            message: 'Student photo uploaded successfully',
            data: {
                ...fileData,
                studentId: studentId,
                url: getFileUrl(req, req.file.filename, PhotoType.STUDENT)
            }
        });
    } catch (error: any) {
        console.error('Error uploading student photo:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to upload student photo',
            details: error.message
        });
    }
};

/**
 * Update student enrollment photo
 * @route PUT /api/v1/students/:id/enrollment-photo
 */
export const updateStudentEnrollmentPhoto = async (req: Request, res: Response): Promise<void> => {
    try {
        const studentId = parseInt(req.params.id);
        const { academic_year_id, photo_filename } = req.body;

        if (isNaN(studentId)) {
            res.status(400).json({
                success: false,
                error: 'Invalid student ID format'
            });
            return;
        }

        if (!photo_filename) {
            res.status(400).json({
                success: false,
                error: 'Photo filename is required'
            });
            return;
        }

        // Validate photo filename exists
        if (!isValidPhotoFilename(photo_filename)) {
            res.status(400).json({
                success: false,
                error: 'Invalid photo filename or file does not exist'
            });
            return;
        }

        const academicYearId = academic_year_id || await getAcademicYearId();

        // Update the enrollment photo
        const updatedEnrollment = await studentService.updateEnrollmentPhoto(
            studentId,
            academicYearId,
            photo_filename
        );

        res.json({
            success: true,
            message: 'Student enrollment photo updated successfully',
            data: {
                studentId: studentId,
                academicYearId: academicYearId,
                photo: photo_filename,
                enrollment: updatedEnrollment
            }
        });
    } catch (error: any) {
        console.error('Error updating student enrollment photo:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

/**
 * Get student enrollment photo info
 * @route GET /api/v1/students/:id/enrollment-photo
 */
export const getStudentEnrollmentPhoto = async (req: Request, res: Response): Promise<void> => {
    try {
        const studentId = parseInt(req.params.id);
        const academicYearId = req.finalQuery.academic_year_id ?
            parseInt(req.finalQuery.academic_year_id as string) :
            await getAcademicYearId();

        if (isNaN(studentId) || !academicYearId) {
            res.status(400).json({
                success: false,
                error: 'Invalid student ID format or missing academic year'
            });
            return;
        }

        const photoInfo = await studentService.getStudentEnrollmentPhoto(studentId, academicYearId);

        // Service returns null only when the student does not exist at all.
        if (!photoInfo) {
            res.status(404).json({
                success: false,
                error: 'Student not found'
            });
            return;
        }

        // Always 200: photo may be null (no photo anywhere) and the caller can decide
        // whether to render a placeholder. `sourceYearId` tells the UI whether the photo
        // came from the requested year or was inherited from a prior enrollment.
        res.json({
            success: true,
            data: {
                studentId: studentId,
                academicYearId: academicYearId,
                photo: photoInfo.photo,
                photoUrl: photoInfo.photo ? getFileUrl(req, photoInfo.photo, PhotoType.STUDENT) : null,
                enrollmentId: photoInfo.enrollmentId,
                sourceYearId: (photoInfo as any).sourceYearId ?? null
            }
        });
    } catch (error: any) {
        console.error('Error getting student enrollment photo:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

export const linkParent = async (req: Request, res: Response) => {
    try {
        const studentId = parseInt(req.params.id);

        if (isNaN(studentId)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid student ID'
            });
        }

        // Use the body directly with student_id - middleware handles conversion
        const linkData = {
            ...req.body,
            student_id: studentId
        };

        if (!linkData.parent_id) {
            return res.status(400).json({
                success: false,
                error: 'Parent ID is required'
            });
        }

        // Validate optional relationship enum
        if (linkData.relationship && !['FATHER', 'MOTHER', 'SIBLING', 'GUARDIAN'].includes(String(linkData.relationship).toUpperCase())) {
            return res.status(400).json({
                success: false,
                error: 'Invalid relationship. Must be FATHER, MOTHER, SIBLING, or GUARDIAN.'
            });
        }

        const newLink = await studentService.linkParent(studentId, linkData);
        res.status(201).json({
            success: true,
            data: newLink
        });
    } catch (error: any) {
        console.error('Error linking parent:', error);

        if (error.message.includes('not found')) {
            return res.status(404).json({
                success: false,
                error: error.message
            });
        }

        if (error.message.includes('already linked')) {
            return res.status(409).json({
                success: false,
                error: error.message
            });
        }

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

export const unlinkParent = async (req: Request, res: Response) => {
    try {
        const studentId = parseInt(req.params.studentId);
        const parentId = parseInt(req.params.parentId);

        if (isNaN(studentId) || isNaN(parentId)) {
            return res.status(400).json({ success: false, error: 'Invalid Student ID or Parent ID format' });
        }

        await studentService.unlinkParent(studentId, parentId);
        res.json({ success: true, message: 'Parent-student link removed successfully' });
    } catch (error: any) {
        console.error('Error unlinking parent:', error);
        if (error.message.includes('not found')) {
            return res.status(404).json({ success: false, error: error.message });
        }
        res.status(500).json({ success: false, error: error.message });
    }
};

export const getParentsByStudentId = async (req: Request, res: Response) => {
    try {
        const studentId = parseInt(req.params.studentId);
        if (isNaN(studentId)) {
            return res.status(400).json({ success: false, error: 'Invalid Student ID format' });
        }

        // The service now returns ParentStudentWithParent[] implicitly due to the include
        const parentStudentLinks = await studentService.getParentsByStudentId(studentId) as ParentStudentWithParent[];

        if (!parentStudentLinks || parentStudentLinks.length === 0) {
            return res.json({ success: true, data: [] });
        }

        const parentsData = parentStudentLinks
            .map(link => link.parent ? transformUser(link.parent) : null)
            .filter(p => p !== null);

        res.json({ success: true, data: parentsData });
    } catch (error: any) {
        console.error('Error fetching parents for student:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

export const enrollStudent = async (req: Request, res: Response): Promise<any> => {
    try {
        const studentId = parseInt(req.params.id);
        if (isNaN(studentId)) {
            return res.status(400).json({ success: false, error: 'Invalid Student ID format' });
        }

        // Expect snake_case from middleware
        const { sub_class_id, academic_year_id, photo, repeater, ream_of_paper_collected } = req.body;

        // Validate and parse sub_class_id
        const parsedSubclassId = parseInt(sub_class_id);
        if (isNaN(parsedSubclassId)) {
            return res.status(400).json({ success: false, error: 'Invalid Subclass ID format' });
        }

        // Validate and parse academic_year_id if present
        let parsedAcademicYearId: number | undefined = undefined;
        if (academic_year_id !== undefined) {
            parsedAcademicYearId = parseInt(academic_year_id);
            if (isNaN(parsedAcademicYearId)) {
                return res.status(400).json({ success: false, error: 'Invalid Academic Year ID format' });
            }
        }

        // Photo is now optional, but if provided, it should be a string or null
        if (photo !== undefined && photo !== null && typeof photo !== 'string') {
            return res.status(400).json({ success: false, error: 'If provided, photo must be a string or null.' });
        }

        // Prepare data for the service
        const enrollmentData = {
            sub_class_id: parsedSubclassId,
            academic_year_id: parsedAcademicYearId, // Pass parsed or undefined
            photo: photo, // Pass photo as received (can be string or null)
            repeater: repeater !== undefined ? Boolean(repeater) : false,
            ream_of_paper_collected: ream_of_paper_collected !== undefined ? Boolean(ream_of_paper_collected) : undefined
        };

        const enrollment = await studentService.enrollStudent(studentId, enrollmentData);
        res.status(201).json({
            success: true,
            data: enrollment
        });
    } catch (error: any) {
        console.error('Error enrolling student:', error);
        // Handle specific errors like P2002 (unique constraint violation)
        if (error.code === 'P2002') {
            return res.status(409).json({ success: false, error: 'Student already enrolled in this sub_class for this academic year.' });
        }
        if (error.message.includes('not found')) {
            return res.status(404).json({ success: false, error: error.message });
        }
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

/**
 * Assign a student to a class (creates enrollment with class only)
 * Sets student status to ASSIGNED_TO_CLASS
 */
export const assignStudentToClass = async (req: Request, res: Response): Promise<any> => {
    try {
        const studentId = parseInt(req.params.id);
        if (isNaN(studentId)) {
            return res.status(400).json({ success: false, error: 'Invalid Student ID format' });
        }

        // Expect snake_case from middleware
        const { class_id, academic_year_id, photo, repeater, ream_of_paper_collected } = req.body;

        // Validate and parse class_id
        const parsedClassId = parseInt(class_id);
        if (isNaN(parsedClassId)) {
            return res.status(400).json({ success: false, error: 'Invalid Class ID format' });
        }

        // Validate and parse academic_year_id if present
        let parsedAcademicYearId: number | undefined = undefined;
        if (academic_year_id !== undefined) {
            parsedAcademicYearId = parseInt(academic_year_id);
            if (isNaN(parsedAcademicYearId)) {
                return res.status(400).json({ success: false, error: 'Invalid Academic Year ID format' });
            }
        }

        // Photo is optional
        if (photo !== undefined && photo !== null && typeof photo !== 'string') {
            return res.status(400).json({ success: false, error: 'If provided, photo must be a string or null.' });
        }

        // Prepare data for the service
        const assignmentData = {
            class_id: parsedClassId,
            academic_year_id: parsedAcademicYearId,
            photo: photo,
            repeater: repeater !== undefined ? Boolean(repeater) : false,
            ream_of_paper_collected: ream_of_paper_collected !== undefined ? Boolean(ream_of_paper_collected) : undefined
        };

        const enrollment = await studentService.assignStudentToClass(studentId, assignmentData);
        res.status(201).json({
            success: true,
            data: enrollment
        });
    } catch (error: any) {
        console.error('Error assigning student to class:', error);
        if (error.message.includes('already assigned to a subclass')) {
            return res.status(409).json({ success: false, error: error.message });
        }
        if (error.message.includes('not found')) {
            return res.status(404).json({ success: false, error: error.message });
        }
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

/**
 * Enroll a student in a subclass (assigns to subclass)
 * Sets student status to ENROLLED
 * This is the final level of enrollment
 */
export const assignStudentToSubclass = async (req: Request, res: Response): Promise<any> => {
    try {
        const studentId = parseInt(req.params.id);
        if (isNaN(studentId)) {
            return res.status(400).json({ success: false, error: 'Invalid Student ID format' });
        }

        const { sub_class_id, academic_year_id } = req.body; // Expect camelCase from middleware

        const parsedSubClassId = parseInt(sub_class_id);
        if (isNaN(parsedSubClassId)) {
            return res.status(400).json({ success: false, error: 'Invalid Subclass ID format' });
        }

        let parsedAcademicYearId: number | undefined = undefined;
        if (academic_year_id !== undefined) {
            parsedAcademicYearId = parseInt(academic_year_id);
            if (isNaN(parsedAcademicYearId)) {
                return res.status(400).json({ success: false, error: 'Invalid Academic Year ID format' });
            }
        }

        const updatedEnrollment = await studentService.assignStudentToSubclass(
            studentId,
            parsedSubClassId,
            parsedAcademicYearId
        );

        res.json({ success: true, data: updatedEnrollment });

    } catch (error: any) {
        console.error('Error assigning student to subclass:', error);
        if (error.message.includes('not enrolled')) {
            return res.status(404).json({ success: false, error: error.message });
        }
        if (error.message.includes('already assigned') || error.message.includes('not found')) {
            return res.status(409).json({ success: false, error: error.message });
        }
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * Get student status information (new/old/repeater)
 */
export const getStudentStatusInfo = async (req: Request, res: Response): Promise<any> => {
    try {
        const studentId = parseInt(req.params.id);
        if (isNaN(studentId)) {
            return res.status(400).json({ success: false, error: 'Invalid Student ID format' });
        }

        // Get academic year from query params or use current
        const academic_year_id = req.finalQuery.academic_year_id ?
            parseInt(req.finalQuery.academic_year_id as string) :
            await getAcademicYearId();

        if (!academic_year_id) {
            return res.status(400).json({ success: false, error: 'Academic year not found' });
        }

        const statusInfo = await getStudentStatus(studentId, academic_year_id);

        res.json({
            success: true,
            data: {
                student_id: studentId,
                academic_year_id,
                ...statusInfo
            }
        });
    } catch (error: any) {
        console.error('Error getting student status:', error);
        if (error.message.includes('not found')) {
            return res.status(404).json({ success: false, error: error.message });
        }
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

/**
 * Get all students with their status information for a given academic year
 */
export const getStudentsWithStatusInfo = async (req: Request, res: Response): Promise<any> => {
    try {
        // Get academic year from query params or use current
        const academic_year_id = req.finalQuery.academic_year_id ?
            parseInt(req.finalQuery.academic_year_id as string) :
            await getAcademicYearId();

        if (!academic_year_id) {
            return res.status(400).json({ success: false, error: 'Academic year not found' });
        }

        // Get sub-class filter if provided
        const sub_class_id = req.finalQuery.sub_class_id ?
            parseInt(req.finalQuery.sub_class_id as string) :
            undefined;

        const studentsWithStatus = await getStudentsWithStatus(academic_year_id, sub_class_id);

        // Group students by status for summary
        const summary = {
            total: studentsWithStatus.length,
            new_students: studentsWithStatus.filter(s => s.statusInfo.status === 'NEW').length,
            old_students: studentsWithStatus.filter(s => s.statusInfo.status === 'OLD').length,
            repeaters: studentsWithStatus.filter(s => s.statusInfo.status === 'REPEATER').length
        };

        res.json({
            success: true,
            data: {
                academic_year_id,
                sub_class_id,
                summary,
                students: studentsWithStatus
            }
        });
    } catch (error: any) {
        console.error('Error getting students with status:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

/**
 * Get all students in a specific subclass
 */
export const getStudentsBySubclass = async (req: Request, res: Response): Promise<any> => {
    try {
        const subclassId = parseInt(req.params.id);
        if (isNaN(subclassId)) {
            return res.status(400).json({ success: false, error: 'Invalid Subclass ID format' });
        }

        // Get academic year from query params or use current
        const academic_year_id = req.finalQuery.academic_year_id ?
            parseInt(req.finalQuery.academic_year_id as string) : undefined;

        const students = await studentService.getStudentsBySubclass(subclassId, academic_year_id);

        res.json({
            success: true,
            data: students
        });
    } catch (error: any) {
        console.error('Error getting students by subclass:', error);
        if (error.message.includes('not found')) {
            return res.status(404).json({ success: false, error: error.message });
        }
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

/**
 * Get all students for a specific parent
 */
export const getStudentsByParent = async (req: Request, res: Response): Promise<any> => {
    try {
        const parentId = parseInt(req.params.parentId);
        if (isNaN(parentId)) {
            return res.status(400).json({ success: false, error: 'Invalid Parent ID format' });
        }

        // Get academic year from query params or use current  
        const academic_year_id = req.finalQuery.academic_year_id ?
            parseInt(req.finalQuery.academic_year_id as string) : undefined;

        const students = await studentService.getStudentsByParentId(parentId, academic_year_id);

        res.json({
            success: true,
            data: students
        });
    } catch (error: any) {
        console.error('Error getting students by parent:', error);
        if (error.message.includes('not found')) {
            return res.status(404).json({ success: false, error: error.message });
        }
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

/**
 * Search students by name or matricule
 */
export const searchStudents = async (req: Request, res: Response): Promise<any> => {
    try {
        const searchQuery = req.query.q as string;

        // Validate search query
        if (!searchQuery || searchQuery.trim().length < 1) {
            return res.status(400).json({
                success: false,
                error: 'Search query is required and must be at least 1 character'
            });
        }

        // Get academic year from query params or use current
        const academic_year_id = req.finalQuery.academic_year_id ?
            parseInt(req.finalQuery.academic_year_id as string) : undefined;

        // Get pagination parameters
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 10;

        const students = await studentService.searchStudents(searchQuery.trim(), academic_year_id, page, limit);

        res.json({
            success: true,
            data: students
        });
    } catch (error: any) {
        console.error('Error searching students:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

export const getStudentByEnrollmentId = async (req: Request, res: Response) => {
    try {
        const enrollmentId = parseInt(req.params.enrollmentId, 10);

        if (isNaN(enrollmentId)) {
            return res.status(400).json({ success: false, error: 'Invalid enrollment ID' });
        }

        const student = await studentService.getStudentByEnrollmentId(enrollmentId);

        if (!student) {
            return res.status(404).json({ success: false, error: 'Student not found for the given enrollment ID' });
        }

        res.json({ success: true, data: student });
    } catch (error: any) {
        console.error('Error fetching student by enrollment ID:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * Export the student list of a single subclass as an Excel file.
 * GET /students/subclass/:id/export
 */
export const exportStudentsBySubclass = async (req: Request, res: Response): Promise<any> => {
    try {
        const subclassId = parseInt(req.params.id);
        if (isNaN(subclassId)) {
            return res.status(400).json({ success: false, error: 'Invalid Subclass ID format' });
        }

        const academicYearId = req.finalQuery.academic_year_id
            ? parseInt(req.finalQuery.academic_year_id as string)
            : undefined;

        const { buffer, filename } = await studentService.exportSubclassStudentListExcel(
            subclassId,
            academicYearId
        );

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(buffer);
    } catch (error: any) {
        console.error('Error exporting subclass student list:', error);
        if (error.message?.includes('not found')) {
            return res.status(404).json({ success: false, error: error.message });
        }
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * Export the student list of a single subclass as a PDF file.
 * GET /students/subclass/:id/export/pdf
 */
export const exportStudentsBySubclassPdf = async (req: Request, res: Response): Promise<any> => {
    try {
        const subclassId = parseInt(req.params.id);
        if (isNaN(subclassId)) {
            return res.status(400).json({ success: false, error: 'Invalid Subclass ID format' });
        }

        const academicYearId = req.finalQuery.academic_year_id
            ? parseInt(req.finalQuery.academic_year_id as string)
            : undefined;

        const { buffer, filename } = await studentService.exportSubclassStudentListPdf(
            subclassId,
            academicYearId
        );

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(buffer);
    } catch (error: any) {
        console.error('Error exporting subclass student list as PDF:', error);
        if (error.message?.includes('not found')) {
            return res.status(404).json({ success: false, error: error.message });
        }
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * Export the student list of a class as a PDF file (one section per subclass).
 * GET /students/class/:classId/export/pdf
 */
export const exportStudentsByClassPdf = async (req: Request, res: Response): Promise<any> => {
    try {
        const classId = parseInt(req.params.classId);
        if (isNaN(classId)) {
            return res.status(400).json({ success: false, error: 'Invalid Class ID format' });
        }

        const academicYearId = req.finalQuery.academic_year_id
            ? parseInt(req.finalQuery.academic_year_id as string)
            : undefined;

        const { buffer, filename } = await studentService.exportClassStudentListPdf(
            classId,
            academicYearId
        );

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(buffer);
    } catch (error: any) {
        console.error('Error exporting class student list as PDF:', error);
        if (error.message?.includes('not found')) {
            return res.status(404).json({ success: false, error: error.message });
        }
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * Export the student list of a class as an Excel file with one sheet per subclass.
 * GET /students/class/:classId/export
 */
export const exportStudentsByClass = async (req: Request, res: Response): Promise<any> => {
    try {
        const classId = parseInt(req.params.classId);
        if (isNaN(classId)) {
            return res.status(400).json({ success: false, error: 'Invalid Class ID format' });
        }

        const academicYearId = req.finalQuery.academic_year_id
            ? parseInt(req.finalQuery.academic_year_id as string)
            : undefined;

        const { buffer, filename } = await studentService.exportClassStudentListExcel(
            classId,
            academicYearId
        );

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(buffer);
    } catch (error: any) {
        console.error('Error exporting class student list:', error);
        if (error.message?.includes('not found')) {
            return res.status(404).json({ success: false, error: error.message });
        }
        res.status(500).json({ success: false, error: error.message });
    }
};

export const getPromotionPreview = async (req: Request, res: Response): Promise<any> => {
    try {
        const fromAcademicYearId = req.query.fromAcademicYearId ? parseInt(req.query.fromAcademicYearId as string) : undefined;
        const toAcademicYearId = req.query.toAcademicYearId ? parseInt(req.query.toAcademicYearId as string) : undefined;

        if (!fromAcademicYearId || !toAcademicYearId) {
            return res.status(400).json({ success: false, error: 'fromAcademicYearId and toAcademicYearId are required' });
        }

        const preview = await studentService.getPromotionPreview(fromAcademicYearId, toAcademicYearId);
        return res.json({ success: true, data: preview });
    } catch (error: any) {
        console.error('Error generating promotion preview:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
};

export const promoteStudents = async (req: Request, res: Response): Promise<any> => {
    try {
        const { fromAcademicYearId, toAcademicYearId, promotions } = req.body;

        if (!fromAcademicYearId || !toAcademicYearId) {
            return res.status(400).json({ success: false, error: 'fromAcademicYearId and toAcademicYearId are required' });
        }
        if (!Array.isArray(promotions) || promotions.length === 0) {
            return res.status(400).json({ success: false, error: 'promotions must be a non-empty array' });
        }

        const mapped = promotions.map((p: any) => ({
            student_id: p.studentId ?? p.student_id,
            target_class_id: p.targetClassId ?? p.target_class_id ?? null,
            repeater: p.repeater,
            action: p.action,
        }));

        const results = await studentService.promoteStudents(fromAcademicYearId, toAcademicYearId, mapped);

        const successCount = results.filter(r => r.success).length;
        return res.json({
            success: true,
            data: {
                total: results.length,
                successful: successCount,
                failed: results.length - successCount,
                results,
            },
        });
    } catch (error: any) {
        console.error('Error promoting students:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
};

// POST /students/:id/unenroll - Unenroll (dismiss) a student from an academic year
export const unenrollStudent = async (req: Request, res: Response): Promise<any> => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) {
            return res.status(400).json({ success: false, error: 'Invalid student ID format' });
        }

        const academicYearIdRaw = req.body?.academic_year_id ?? req.query?.academic_year_id;
        const academicYearId = academicYearIdRaw !== undefined && academicYearIdRaw !== null && academicYearIdRaw !== ''
            ? parseInt(academicYearIdRaw as string)
            : undefined;
        if (academicYearId !== undefined && isNaN(academicYearId)) {
            return res.status(400).json({ success: false, error: 'Invalid academic year ID format' });
        }

        const result = await studentService.unenrollStudent(id, academicYearId);
        return res.json({ success: true, message: 'Student unenrolled successfully', data: result });
    } catch (error: any) {
        console.error('Error unenrolling student:', error);
        switch (error.message) {
            case 'STUDENT_NOT_FOUND':
                return res.status(404).json({ success: false, error: 'Student not found' });
            case 'ENROLLMENT_NOT_FOUND':
                return res.status(404).json({ success: false, error: 'Student is not enrolled in the specified academic year' });
            case 'ACADEMIC_YEAR_NOT_FOUND':
                return res.status(400).json({ success: false, error: 'No academic year specified and no current academic year is set' });
            case 'ENROLLMENT_HAS_ACADEMIC_RECORDS':
                return res.status(409).json({ success: false, error: 'Cannot unenroll: student has marks, attendance or discipline records for this year' });
            case 'ENROLLMENT_HAS_FINANCIAL_RECORDS':
                return res.status(409).json({ success: false, error: 'Cannot unenroll: student has payment or refund records for this year' });
            default:
                return res.status(500).json({ success: false, error: error.message });
        }
    }
};

// DELETE /students/:id - Withdraw a student (soft delete: status -> WITHDRAWN).
// See studentService.deleteStudent for why this is no longer a hard delete.
export const deleteStudent = async (req: Request, res: Response): Promise<any> => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) {
            return res.status(400).json({ success: false, error: 'Invalid student ID format' });
        }
        if (!req.user || !req.user.id) {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }

        await studentService.deleteStudent(id, req.user.id);
        return res.json({ success: true, message: 'Student withdrawn successfully' });
    } catch (error: any) {
        console.error('Error deleting student:', error);
        if (error.message === 'STUDENT_NOT_FOUND' || error.code === 'P2025') {
            return res.status(404).json({ success: false, error: 'Student not found' });
        }
        return res.status(500).json({ success: false, error: 'Failed to delete student due to an internal error' });
    }
};

// GET /students/:id/siblings - Other students sharing at least one parent with this student
export const getStudentSiblings = async (req: Request, res: Response): Promise<any> => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) {
            return res.status(400).json({ success: false, error: 'Invalid student ID format' });
        }
        const siblings = await studentService.getStudentSiblings(id);
        return res.json({ success: true, data: siblings });
    } catch (error: any) {
        if (error.message === 'STUDENT_NOT_FOUND') {
            return res.status(404).json({ success: false, error: 'Student not found' });
        }
        console.error('Error fetching siblings:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
};

// GET /students/:id/previous-schools
export const listPreviousSchools = async (req: Request, res: Response): Promise<any> => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) {
            return res.status(400).json({ success: false, error: 'Invalid student ID format' });
        }
        const data = await studentService.listPreviousSchools(id);
        return res.json({ success: true, data });
    } catch (error: any) {
        if (error.message === 'STUDENT_NOT_FOUND') {
            return res.status(404).json({ success: false, error: 'Student not found' });
        }
        return res.status(500).json({ success: false, error: error.message });
    }
};

// POST /students/:id/previous-schools
export const addPreviousSchool = async (req: Request, res: Response): Promise<any> => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) {
            return res.status(400).json({ success: false, error: 'Invalid student ID format' });
        }
        const data = await studentService.addPreviousSchool(id, req.body);
        return res.status(201).json({ success: true, data });
    } catch (error: any) {
        if (error.message === 'STUDENT_NOT_FOUND') {
            return res.status(404).json({ success: false, error: 'Student not found' });
        }
        return res.status(400).json({ success: false, error: error.message });
    }
};

// PUT /students/:id/previous-schools/:psId
export const updatePreviousSchool = async (req: Request, res: Response): Promise<any> => {
    try {
        const id = parseInt(req.params.id);
        const psId = parseInt(req.params.psId);
        if (isNaN(id) || isNaN(psId)) {
            return res.status(400).json({ success: false, error: 'Invalid ID format' });
        }
        const data = await studentService.updatePreviousSchool(id, psId, req.body);
        return res.json({ success: true, data });
    } catch (error: any) {
        if (error.message === 'PREVIOUS_SCHOOL_NOT_FOUND') {
            return res.status(404).json({ success: false, error: 'Previous school entry not found' });
        }
        return res.status(400).json({ success: false, error: error.message });
    }
};

// DELETE /students/:id/previous-schools/:psId
export const deletePreviousSchool = async (req: Request, res: Response): Promise<any> => {
    try {
        const id = parseInt(req.params.id);
        const psId = parseInt(req.params.psId);
        if (isNaN(id) || isNaN(psId)) {
            return res.status(400).json({ success: false, error: 'Invalid ID format' });
        }
        await studentService.deletePreviousSchool(id, psId);
        return res.json({ success: true, message: 'Previous school entry deleted' });
    } catch (error: any) {
        if (error.message === 'PREVIOUS_SCHOOL_NOT_FOUND') {
            return res.status(404).json({ success: false, error: 'Previous school entry not found' });
        }
        return res.status(500).json({ success: false, error: error.message });
    }
};