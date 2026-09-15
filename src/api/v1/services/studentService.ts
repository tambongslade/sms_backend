// src/api/v1/services/studentService.ts
import prisma, { Student, ParentStudent, Gender, Enrollment, Prisma } from '../../../config/db';
import { getAcademicYearId, getStudentSubclassByStudentAndYear } from '../../../utils/academicYear';
import { paginate, PaginationOptions, FilterOptions, PaginatedResult } from '../../../utils/pagination';
import * as feeService from './feeService'; // Import feeService
import { generateStudentMatricule } from '../../../utils/matriculeGenerator'; // Import student matricule generator
import { setFirstEnrollmentYear, updateNewStudentStatus } from '../../../utils/studentStatus'; // Import student status utilities
import { StudentStatus, HealthCondition } from '@prisma/client'; // Import StudentStatus + HealthCondition enums
import { createAuditLog } from './auditTrailService';
import * as XLSX from 'xlsx';
import { PDFDocument, StandardFonts, rgb, PageSizes, PDFFont, PDFPage } from 'pdf-lib';

// Get all students with pagination and filtering
export async function getAllStudents(
    paginationOptions?: PaginationOptions,
    filterOptions?: FilterOptions
): Promise<PaginatedResult<Student>> {
    return paginate<Student>(
        prisma.student,
        paginationOptions,
        filterOptions
    );
}

// Get all students with their current enrollment info with pagination and filtering
export async function getAllStudentsWithCurrentEnrollment(
    academicYearIdInput?: number, // Explicitly name the input
    paginationOptions?: PaginationOptions,
    filterOptions?: FilterOptions,
    enrollmentStatus?: 'enrolled' | 'not_enrolled' | 'all', // Add enrollmentStatus parameter
    teacherSubClassIds?: number[] // Add teacher subclass restriction
): Promise<PaginatedResult<any>> {

    // 1. Determine Target Academic Year
    const targetAcademicYearId = academicYearIdInput ?? await getAcademicYearId();
    if (!targetAcademicYearId) {
        throw new Error("Target academic year could not be determined.");
    }

    // 2. Build Base Where Clause for Student Filters
    const studentWhere: Prisma.StudentWhereInput = {};
    let sub_classIdFilter: number | undefined = undefined; // Store sub_class filter separately

    if (filterOptions) {
        for (const key in filterOptions) {
            const value = filterOptions[key];
            if (value === undefined || value === null || value === '') continue;

            if (key === 'name' || key === 'matricule' || key === 'gender') {
                studentWhere[key] = key === 'name' ? { contains: value, mode: 'insensitive' } : value;
            } else if (key === 'id') {
                const parsedId = parseInt(value as string);
                if (!isNaN(parsedId)) {
                    studentWhere.id = parsedId;
                }
            } else if (key === 'sub_class_id') {
                // Store sub_class_id filter, apply later conditionally
                const parsedSubclassId = parseInt(value as string);
                if (!isNaN(parsedSubclassId)) {
                    sub_classIdFilter = parsedSubclassId;
                }
            }
            // Note: class_id filter is removed as it's complex to apply reliably across all enrollment statuses
            //       without potentially incorrect results. Filter by sub_class_id instead if needed.
        }
    }

    // 3. Build Combined Subclass Filter Logic
    // Combine teacher restrictions with explicit subclass filter
    let finalSubclassFilter: number | number[] | undefined = undefined;

    if (teacherSubClassIds && teacherSubClassIds.length > 0) {
        if (sub_classIdFilter !== undefined) {
            // Teacher has restrictions AND explicit subclass filter provided
            // Only allow the explicit filter if it's within teacher's allowed subclasses
            if (teacherSubClassIds.includes(sub_classIdFilter)) {
                finalSubclassFilter = sub_classIdFilter;
                console.log(`Applying combined filter: teacher-restricted subclass ${sub_classIdFilter}`);
            } else {
                // Requested subclass is not in teacher's allowed list - return empty result
                console.log(`Subclass ${sub_classIdFilter} not in teacher's allowed subclasses ${teacherSubClassIds.join(', ')}. No students will be returned.`);
                finalSubclassFilter = -1; // Use invalid ID to return no results
            }
        } else {
            // Teacher has restrictions but no explicit filter - show all their allowed subclasses
            finalSubclassFilter = teacherSubClassIds;
            console.log(`Applying teacher restriction: students must be in subclasses ${teacherSubClassIds.join(', ')}`);
        }
    } else if (sub_classIdFilter !== undefined) {
        // No teacher restrictions but explicit subclass filter provided
        finalSubclassFilter = sub_classIdFilter;
        console.log(`Applying explicit subclass filter: ${sub_classIdFilter}`);
    }

    // 4. Apply Enrollment Status Filtering
    const enrollmentCriteria: Prisma.EnrollmentWhereInput = {
        academic_year_id: targetAcademicYearId
    };

    // Apply the final subclass filter to enrollment criteria
    if (finalSubclassFilter !== undefined) {
        if (Array.isArray(finalSubclassFilter)) {
            enrollmentCriteria.sub_class_id = { in: finalSubclassFilter };
        } else {
            enrollmentCriteria.sub_class_id = finalSubclassFilter;
        }
    }

    if (enrollmentStatus === 'enrolled') {
        studentWhere.enrollments = { some: enrollmentCriteria };
        console.log("Applying filter: ENROLLED");
    } else if (enrollmentStatus === 'not_enrolled') {
        // Cannot filter by sub_class if looking for non-enrolled students
        if (sub_classIdFilter !== undefined) {
            console.warn("Subclass filter ignored when enrollmentStatus is 'not_enrolled'");
        }
        if (teacherSubClassIds && teacherSubClassIds.length > 0) {
            // For teachers, we can't show not_enrolled students as they can only see their assigned students
            studentWhere.enrollments = {
                none: {
                    academic_year_id: targetAcademicYearId,
                    sub_class_id: { in: teacherSubClassIds }
                }
            };
        } else {
            studentWhere.enrollments = { none: { academic_year_id: targetAcademicYearId } };
        }
        console.log("Applying filter: NOT ENROLLED");
    } else { // Default to 'all' if enrollmentStatus is undefined or 'all'
        if (finalSubclassFilter !== undefined) {
            // Apply subclass filter for 'all' status - only show students who have enrollments in the filtered subclasses
            studentWhere.enrollments = { some: enrollmentCriteria };
            console.log("Applying filter: ALL with subclass filter");
        } else {
            // No subclass filter - don't add enrollment conditions to studentWhere for 'all'
            // but included enrollments are still filtered by academic year in the include
            console.log("Applying filter: ALL (Default) - No subclass filter");
        }
    }

    console.log("Final Student Where:", JSON.stringify(studentWhere));
    console.log("Enrollment Criteria for Include:", JSON.stringify(enrollmentCriteria));


    // 4. Count total students matching the combined filters
    const total = await prisma.student.count({ where: studentWhere });
    console.log(`Total matching students found: ${total}`);

    // 5. Pagination setup
    const page = paginationOptions?.page || 1;
    const limit = paginationOptions?.limit || 10;
    const skip = (page - 1) * limit;
    const totalPages = Math.ceil(total / limit);

    // 6. Build orderBy
    let orderBy: Prisma.StudentOrderByWithRelationInput | Prisma.StudentOrderByWithRelationInput[] | undefined;
    if (paginationOptions?.sortBy) {
        // Basic sorting on student fields
        if (['name', 'matricule', 'gender', 'id', 'date_of_birth', 'created_at'].includes(paginationOptions.sortBy)) {
            orderBy = { [paginationOptions.sortBy]: paginationOptions.sortOrder || 'asc' };
        } else {
            console.warn(`Unsupported sort_by field: ${paginationOptions.sortBy}. Ignoring sort.`);
        }
    } else {
        orderBy = { name: 'asc' }; // Default sort
    }


    // 7. Fetch paginated students matching the criteria
    const students = await prisma.student.findMany({
        where: studentWhere,
        skip,
        take: limit,
        orderBy,
        include: {
            // Always include enrollments for the target year to show status
            enrollments: {
                where: enrollmentCriteria, // Apply academic year and potentially sub_class filter here
                include: {
                    sub_class: {
                        include: {
                            class: true
                        }
                    }
                }
            },
            parents: {
                include: {
                    parent: true // Include parent details
                }
            }
        }
    });

    console.log(`Returning ${students.length} students for page ${page}`);

    return {
        data: students,
        meta: {
            total,
            page,
            limit,
            totalPages
        }
    };
}

export async function createStudent(data: {
    matricule?: string; // Make matricule optional in input
    name?: string; // Derived from nom + prenom if not provided
    nom?: string; // Family name
    prenom?: string; // Given name
    date_of_birth: string;
    place_of_birth: string;
    gender: string;
    residence: string;
    former_school?: string;
    is_new_student?: boolean; // Add support for new/old student tracking
    status?: StudentStatus; // Add support for initial status
    admission_academic_year_id?: number; // User-selectable admission year
    health_conditions?: HealthCondition[]; // Predefined health enum list
    medical_notes?: string;
    previous_schools?: Array<{
        school_name: string;
        from_year?: string;
        to_year?: string;
        notes?: string;
    }>;
}): Promise<Student> {

    // Derive name from nom + prenom (or accept legacy `name`)
    const nom = data.nom?.trim();
    const prenom = data.prenom?.trim();
    const fullName = (nom && prenom) ? `${nom} ${prenom}` : (data.name?.trim() || '');

    // Validate required fields
    if (!fullName || !data.date_of_birth || !data.place_of_birth || !data.gender || !data.residence) {
        throw new Error("Missing required fields: nom + prenom (or name), date_of_birth, place_of_birth, gender, and residence are required");
    }

    // Validate and normalize gender
    let normalizedGender: Gender;
    const genderLower = data.gender.toLowerCase();
    if (genderLower === 'male') {
        normalizedGender = Gender.Male;
    } else if (genderLower === 'female') {
        normalizedGender = Gender.Female;
    } else {
        throw new Error("Invalid gender. Choose a valid gender.");
    }

    // Validate date of birth
    const dateOfBirth = new Date(data.date_of_birth);
    if (isNaN(dateOfBirth.getTime())) {
        throw new Error("Invalid date of birth format");
    }

    // Check if date of birth is not in the future
    if (dateOfBirth > new Date()) {
        throw new Error("Date of birth cannot be in the future");
    }

    // Generate matricule if not provided
    let studentMatricule = data.matricule;
    if (!studentMatricule) {
        studentMatricule = await generateStudentMatricule();
    }

    // Check if matricule already exists
    const existingStudent = await prisma.student.findUnique({
        where: { matricule: studentMatricule }
    });

    if (existingStudent) {
        throw new Error(`Student with matricule ${studentMatricule} already exists`);
    }

    // Set defaults for new/old student and status
    const isNewStudent = data.is_new_student !== undefined ? data.is_new_student : true;
    const studentStatus = data.status || StudentStatus.NOT_ENROLLED;

    // Validate admission academic year if provided
    if (data.admission_academic_year_id !== undefined && data.admission_academic_year_id !== null) {
        const year = await prisma.academicYear.findUnique({
            where: { id: data.admission_academic_year_id },
            select: { id: true },
        });
        if (!year) {
            throw new Error(`Admission academic year with ID ${data.admission_academic_year_id} does not exist`);
        }
    }

    // Dedupe & validate health conditions
    const healthConditions = data.health_conditions
        ? Array.from(new Set(data.health_conditions))
        : [];
    for (const hc of healthConditions) {
        if (!Object.values(HealthCondition).includes(hc)) {
            throw new Error(`Invalid health condition: ${hc}`);
        }
    }

    // Filter and sanitize previous schools
    const previousSchools = (data.previous_schools || [])
        .filter((s) => s && s.school_name && s.school_name.trim().length > 0)
        .map((s) => ({
            school_name: s.school_name.trim(),
            from_year: s.from_year?.trim() || null,
            to_year: s.to_year?.trim() || null,
            notes: s.notes?.trim() || null,
        }));

    try {
        return await prisma.$transaction(async (tx) => {
            const student = await tx.student.create({
                data: {
                    matricule: studentMatricule!,
                    name: fullName,
                    nom: nom || null,
                    prenom: prenom || null,
                    place_of_birth: data.place_of_birth.trim(),
                    gender: normalizedGender,
                    residence: data.residence.trim(),
                    former_school: data.former_school?.trim() || null,
                    date_of_birth: dateOfBirth,
                    is_new_student: isNewStudent,
                    status: studentStatus,
                    admission_academic_year_id: data.admission_academic_year_id ?? null,
                    health_conditions: healthConditions,
                    medical_notes: data.medical_notes?.trim() || null,
                    // first_enrollment_year_id will be set when student is first enrolled
                },
            });
            if (previousSchools.length > 0) {
                await tx.studentPreviousSchool.createMany({
                    data: previousSchools.map((ps) => ({
                        student_id: student.id,
                        ...ps,
                    })),
                });
            }
            return student;
        });
    } catch (error: any) {
        if (error.code === 'P2002') {
            throw new Error("Student with this matricule already exists");
        }
        throw new Error(`Failed to create student: ${error.message}`);
    }
}

export async function updateStudent(
    id: number,
    data: Partial<Omit<Student, 'id' | 'created_at' | 'updated_at'>> & {
        ream_of_paper_collected?: boolean;
        academic_year_id?: number;
    }
): Promise<Student & { enrollment?: Enrollment }> {
    // Check if is_new_student field is being updated for fee recalculation
    const isNewStudentChanged = data.is_new_student !== undefined;
    let previousIsNewStudent: boolean | undefined;

    if (isNewStudentChanged) {
        // Get current is_new_student value before update
        const currentStudent = await prisma.student.findUnique({
            where: { id },
            select: { is_new_student: true }
        });
        previousIsNewStudent = currentStudent?.is_new_student;
    }

    const updateData: Prisma.StudentUpdateInput = {};

    // Fields to skip - either because they need special processing, are camelCase duplicates,
    // or belong on the enrollment record rather than the student record
    const fieldsToSkip = [
        'date_of_birth',
        'gender',
        'dateOfBirth',                // camelCase version that gets converted to date_of_birth
        'placeOfBirth',               // camelCase version that gets converted to place_of_birth
        'formerSchool',               // camelCase version that gets converted to former_school
        'ream_of_paper_collected',    // belongs to Enrollment, handled below
        'reamOfPaperCollected',
        'academic_year_id',           // scoping field for the enrollment update, not a Student column
        'academicYearId',
        // Discipline extensions: previous schools have their own sub-resource endpoints;
        // health_conditions / medical_notes / admission_academic_year_id flow through the copy loop.
        'previous_schools',
        'previousSchools',
        'healthConditions',           // camelCase mirror (middleware converts, but guard for safety)
        'admissionAcademicYearId',
        'medicalNotes'
    ];

    // Copy all fields except the ones we need to process specially or skip
    for (const [key, value] of Object.entries(data)) {
        if (!fieldsToSkip.includes(key)) {
            updateData[key as keyof Prisma.StudentUpdateInput] = value as any;
        }
    }

    // Handle date_of_birth conversion
    if (data.date_of_birth && typeof data.date_of_birth === 'string') {
        updateData.date_of_birth = new Date(data.date_of_birth);
    } else if (data.date_of_birth instanceof Date) {
        updateData.date_of_birth = data.date_of_birth;
    }

    // Handle gender conversion
    if (data.gender) {
        const genderLower = data.gender.toLowerCase();
        if (genderLower === 'male') {
            updateData.gender = Gender.Male;
        } else if (genderLower === 'female') {
            updateData.gender = Gender.Female;
        } else {
            throw new Error("Invalid gender. Choose a valid gender.");
        }
    }

    // Keep `name` in sync when nom/prenom are updated
    const updatingNom = (data as any).nom !== undefined;
    const updatingPrenom = (data as any).prenom !== undefined;
    if (updatingNom || updatingPrenom) {
        const current = await prisma.student.findUnique({
            where: { id },
            select: { nom: true, prenom: true }
        });
        const newNom = updatingNom ? ((data as any).nom?.trim() || null) : current?.nom ?? null;
        const newPrenom = updatingPrenom ? ((data as any).prenom?.trim() || null) : current?.prenom ?? null;
        if (newNom && newPrenom) {
            updateData.name = `${newNom} ${newPrenom}`;
        }
    }

    // Validate admission_academic_year_id if being updated
    if ((data as any).admission_academic_year_id !== undefined && (data as any).admission_academic_year_id !== null) {
        const year = await prisma.academicYear.findUnique({
            where: { id: (data as any).admission_academic_year_id },
            select: { id: true },
        });
        if (!year) {
            throw new Error(`Admission academic year with ID ${(data as any).admission_academic_year_id} does not exist`);
        }
    }

    // Dedupe health_conditions if provided
    if (Array.isArray((data as any).health_conditions)) {
        const deduped = Array.from(new Set((data as any).health_conditions as HealthCondition[]));
        for (const hc of deduped) {
            if (!Object.values(HealthCondition).includes(hc)) {
                throw new Error(`Invalid health condition: ${hc}`);
            }
        }
        (updateData as any).health_conditions = deduped;
    }

    const updatedStudent = await prisma.student.update({
        where: { id },
        data: updateData,
    });

    // Recalculate fees if is_new_student field changed and student is enrolled
    if (isNewStudentChanged && previousIsNewStudent !== data.is_new_student) {
        await recalculateStudentFees(id);
    }

    // Handle ream-of-paper update on the enrollment (Enrollment.ream_of_paper_collected)
    let enrollmentUpdate: Enrollment | undefined;
    if (data.ream_of_paper_collected !== undefined) {
        const yearId = await getAcademicYearId(data.academic_year_id);
        if (!yearId) {
            throw new Error('Academic Year ID is required to update ream of paper collection but could not be determined.');
        }
        const enrollment = await prisma.enrollment.findUnique({
            where: { student_id_academic_year_id: { student_id: id, academic_year_id: yearId } }
        });
        if (!enrollment) {
            throw new Error(`No enrollment found for student ${id} in academic year ${yearId}. The student must be enrolled before updating ream of paper collection.`);
        }
        enrollmentUpdate = await prisma.enrollment.update({
            where: { id: enrollment.id },
            data: { ream_of_paper_collected: Boolean(data.ream_of_paper_collected) }
        });
    }

    return enrollmentUpdate
        ? { ...updatedStudent, enrollment: enrollmentUpdate }
        : updatedStudent;
}

/**
 * Recalculates fees for all enrollments of a student when is_new_student field changes
 * @param studentId - The ID of the student
 */
async function recalculateStudentFees(studentId: number): Promise<void> {
    try {
        // Get all enrollments for the student
        const enrollments = await prisma.enrollment.findMany({
            where: { student_id: studentId },
            include: {
                sub_class: {
                    include: { class: true }
                },
                school_fees: true
            }
        });

        console.log(`Recalculating fees for student ${studentId} - found ${enrollments.length} enrollments`);

        // For each enrollment, recalculate and update the fees
        for (const enrollment of enrollments) {
            if (enrollment.sub_class?.class) {
                // Use the existing fee service to recalculate and update fees
                await feeService.createOrUpdateFeeForEnrollment(enrollment.id, enrollment.sub_class.class.id);
                console.log(`Updated fees for enrollment ${enrollment.id} in class ${enrollment.sub_class.class.name}`);
            }
        }

        console.log(`Successfully recalculated fees for student ${studentId}`);
    } catch (error: any) {
        console.error(`Error recalculating fees for student ${studentId}:`, error);
        throw new Error(`Failed to recalculate fees: ${error.message}`);
    }
}

export async function getStudentFullProfileBase(id: number): Promise<any> {
    return prisma.student.findUnique({
        where: { id },
        include: {
            parents: { include: { parent: true } },
            first_enrollment_year: true,
            admission_academic_year: true,
            previous_schools: { orderBy: { id: 'asc' } },
            interview_marks: true,
            enrollments: {
                orderBy: { academic_year_id: 'desc' },
                include: {
                    academic_year: true,
                    class: true,
                    sub_class: { include: { class: true } },
                    student_sequence_averages: {
                        include: { exam_sequence: true },
                        orderBy: { exam_sequence_id: 'asc' },
                    },
                },
            },
        },
    });
}

export async function getStudentById(id: number, academicYearId?: number): Promise<any> {
    // Get the academic year if provided
    let yearId = undefined;
    if (academicYearId !== undefined) {
        yearId = academicYearId;
    } else {
        yearId = await getAcademicYearId();
    }

    return prisma.student.findUnique({
        where: { id },
        include: {
            parents: {
                include: {
                    parent: true
                }
            },
            enrollments: yearId ? {
                where: {
                    academic_year_id: yearId
                },
                include: {
                    sub_class: {
                        include: {
                            class: true
                        }
                    }
                }
            } : true,
        },
    });
}

export async function linkParent(
    student_id: number,
    data: { parent_id: number; relationship?: string }
): Promise<ParentStudent> {
    // First verify that both student and parent exist
    const student = await prisma.student.findUnique({
        where: { id: student_id }
    });

    if (!student) {
        throw new Error(`Student with ID ${student_id} not found`);
    }

    const parent = await prisma.user.findUnique({
        where: { id: data.parent_id }
    });

    if (!parent) {
        throw new Error(`Parent with ID ${data.parent_id} not found`);
    }

    // Check if relationship already exists
    const existingLink = await prisma.parentStudent.findFirst({
        where: {
            student_id: student_id,
            parent_id: data.parent_id
        }
    });

    if (existingLink) {
        throw new Error(`Parent ${data.parent_id} is already linked to student ${student_id}`);
    }

    const normalizedRelationship = normalizeRelationship(data.relationship);

    return prisma.parentStudent.create({
        data: {
            student: { connect: { id: student_id } },
            parent: { connect: { id: data.parent_id } },
            ...(normalizedRelationship ? { relationship: normalizedRelationship } : {})
        }
    });
}

/**
 * Normalize a relationship string to the Relationship enum.
 * Accepts case-insensitive FATHER/MOTHER/SIBLING/GUARDIAN.
 * Returns undefined when input is missing or unrecognized.
 */
export function normalizeRelationship(input?: string | null): 'FATHER' | 'MOTHER' | 'SIBLING' | 'GUARDIAN' | undefined {
    if (!input) return undefined;
    const upper = input.trim().toUpperCase();
    if (['FATHER', 'MOTHER', 'SIBLING', 'GUARDIAN'].includes(upper)) {
        return upper as any;
    }
    return undefined;
}

/**
 * Assigns a student to a class (creates enrollment with class only)
 * Sets student status to ASSIGNED_TO_CLASS
 */
export async function assignStudentToClass(
    student_id: number,
    data: {
        class_id: number;
        academic_year_id?: number;
        photo?: string | null;
        repeater?: boolean;
        ream_of_paper_collected?: boolean;
    }
): Promise<Enrollment & { fee_id: number }> {
    // Get current academic year if not provided
    const yearId = data.academic_year_id ?? await getAcademicYearId();
    if (!yearId) {
        throw new Error("No academic year found and none provided");
    }

    // Get class details
    const classData = await prisma.class.findUnique({
        where: { id: data.class_id }
    });

    if (!classData) {
        throw new Error(`Class with ID ${data.class_id} not found`);
    }

    // Check if student is already enrolled in this academic year
    const existingEnrollment = await prisma.enrollment.findUnique({
        where: {
            student_id_academic_year_id: {
                student_id: student_id,
                academic_year_id: yearId
            }
        },
        include: {
            school_fees: true
        }
    });

    let enrollment: Enrollment;
    let fee_id: number;

    if (existingEnrollment) {
        // Check if already assigned to a subclass
        if (existingEnrollment.sub_class_id) {
            throw new Error("Student is already assigned to a subclass. Cannot reassign to class only.");
        }

        // Update existing enrollment with class assignment
        enrollment = await prisma.enrollment.update({
            where: { id: existingEnrollment.id },
            data: {
                class_id: data.class_id,
                photo: data.photo ?? existingEnrollment.photo,
                repeater: data.repeater ?? existingEnrollment.repeater,
                ream_of_paper_collected: data.ream_of_paper_collected ?? existingEnrollment.ream_of_paper_collected,
            }
        });

        // Create or update fee record based on the new class assignment
        const fee = await feeService.createOrUpdateFeeForEnrollment(enrollment.id, data.class_id);
        fee_id = fee.id;
    } else {
        // Create new enrollment with class only
        enrollment = await prisma.enrollment.create({
            data: {
                student_id,
                class_id: data.class_id,
                sub_class_id: null, // No subclass assignment yet
                academic_year_id: yearId,
                repeater: data.repeater ?? false,
                photo: data.photo ?? null,
                ream_of_paper_collected: data.ream_of_paper_collected ?? false,
            },
        });

        // Set first enrollment year if this is the student's first enrollment
        await setFirstEnrollmentYear(student_id, yearId);

        // Create fee record for the enrollment based on class
        const fee = await feeService.createOrUpdateFeeForEnrollment(enrollment.id, data.class_id);
        fee_id = fee.id;
    }

    // Update is_new_student field based on enrollment history
    await updateNewStudentStatus(student_id);

    // Update student status to ASSIGNED_TO_CLASS
    await prisma.student.update({
        where: { id: student_id },
        data: { status: StudentStatus.ASSIGNED_TO_CLASS }
    });

    console.log('Student assigned to class:', enrollment);
    return { ...enrollment, fee_id };
}

/**
 * Enrolls a student in a subclass (assigns to subclass)
 * Sets student status to ENROLLED
 * Can be used for both new enrollments and updating existing ones
 */
export async function enrollStudentInSubclass(
    student_id: number,
    data: {
        sub_class_id: number;
        academic_year_id?: number;
        photo?: string | null;
        repeater?: boolean;
        ream_of_paper_collected?: boolean;
    }
): Promise<Enrollment & { fee_id: number }> {
    // Get current academic year if not provided
    const yearId = data.academic_year_id ?? await getAcademicYearId();
    if (!yearId) {
        throw new Error("No academic year found and none provided");
    }

    // Get sub_class and its parent class
    const sub_class = await prisma.subClass.findUnique({
        where: { id: data.sub_class_id },
        include: { class: true }
    });

    if (!sub_class || !sub_class.class) {
        throw new Error(`Subclass with ID ${data.sub_class_id} or its parent Class not found`);
    }

    // Check if student is already enrolled in this academic year
    const existingEnrollment = await prisma.enrollment.findUnique({
        where: {
            student_id_academic_year_id: {
                student_id: student_id,
                academic_year_id: yearId
            }
        },
        include: {
            school_fees: true
        }
    });

    let enrollment: Enrollment;
    let fee_id: number;

    if (existingEnrollment) {
        // Update existing enrollment with subclass assignment
        enrollment = await prisma.enrollment.update({
            where: { id: existingEnrollment.id },
            data: {
                sub_class_id: data.sub_class_id,
                class_id: sub_class.class_id,
                photo: data.photo ?? existingEnrollment.photo,
                repeater: data.repeater ?? existingEnrollment.repeater,
                ream_of_paper_collected: data.ream_of_paper_collected ?? existingEnrollment.ream_of_paper_collected,
            }
        });

        // Create or update fee record based on the class of the subclass
        const fee = await feeService.createOrUpdateFeeForEnrollment(enrollment.id, sub_class.class_id);
        fee_id = fee.id;
    } else {
        // Create new enrollment with subclass (for old students directly enrolling in subclass)
        enrollment = await prisma.enrollment.create({
            data: {
                student_id,
                class_id: sub_class.class_id,
                sub_class_id: data.sub_class_id,
                academic_year_id: yearId,
                repeater: data.repeater ?? false,
                photo: data.photo ?? null,
                ream_of_paper_collected: data.ream_of_paper_collected ?? false,
            },
        });

        // Set first enrollment year if this is the student's first enrollment
        await setFirstEnrollmentYear(student_id, yearId);

        // Create fee record for the enrollment based on the class of the subclass
        const fee = await feeService.createOrUpdateFeeForEnrollment(enrollment.id, sub_class.class_id);
        fee_id = fee.id;
    }

    // Update is_new_student field based on enrollment history
    await updateNewStudentStatus(student_id);

    // Update student status to ENROLLED when assigned to subclass
    await prisma.student.update({
        where: { id: student_id },
        data: { status: StudentStatus.ENROLLED }
    });

    console.log('Student enrolled in subclass:', enrollment);
    return { ...enrollment, fee_id };
}

// Keep the old enrollStudent function for backward compatibility
// but make it call enrollStudentInSubclass
export async function enrollStudent(
    student_id: number,
    data: {
        sub_class_id: number;
        academic_year_id?: number;
        photo: string | null;
        repeater?: boolean;
        ream_of_paper_collected?: boolean;
    }
): Promise<Enrollment & { fee_id: number }> {
    return enrollStudentInSubclass(student_id, data);
}

// Get students by sub_class for a specific academic year
export async function getStudentsBySubclass(
    sub_class_id: number,
    academicYearId?: number
): Promise<Enrollment[]> {
    // Get the academic year
    const yearId = await getAcademicYearId(academicYearId);
    if (!yearId) {
        return [];
    }

    // Get students enrolled in this sub_class for this academic year
    return prisma.enrollment.findMany({
        where: {
            sub_class_id,
            academic_year_id: yearId
        },
        include: {
            student: true,
            sub_class: {
                include: {
                    class: true
                }
            }
        }
    });
}

export async function unlinkParent(student_id: number, parent_id: number): Promise<void> {
    const result = await prisma.parentStudent.deleteMany({
        where: {
            student_id: student_id,
            parent_id: parent_id
        }
    });

    if (result.count === 0) {
        throw new Error('Parent-student link not found or already deleted.');
    }
}

export async function getStudentsByParentId(parentId: number, academicYearId?: number): Promise<Student[]> {
    const targetAcademicYearId = academicYearId ?? await getAcademicYearId();

    const parentStudents = await prisma.parentStudent.findMany({
        where: {
            parent_id: parentId
        },
        include: {
            student: {
                include: {
                    enrollments: targetAcademicYearId ? {
                        where: { academic_year_id: targetAcademicYearId },
                        include: {
                            sub_class: { include: { class: true } }
                        }
                    } : true,
                }
            }
        }
    });
    return parentStudents.map(ps => ps.student);
}

export async function getParentsByStudentId(studentId: number): Promise<ParentStudent[]> {
    return prisma.parentStudent.findMany({
        where: {
            student_id: studentId
        },
        include: {
            parent: true // Assuming 'parent' is the relation to the User model for parents
        }
    });
}

/**
 * Assigns a student to a subclass if they have an existing enrollment in the academic year and no current subclass.
 * @param studentId The ID of the student.
 * @param subClassId The ID of the subclass to assign.
 * @param academicYearId Optional academic year ID (defaults to current).
 * @returns The updated Enrollment record.
 */
export async function assignStudentToSubclass(
    studentId: number,
    subClassId: number,
    academicYearId?: number
): Promise<Enrollment> {
    const yearId = academicYearId ?? await getAcademicYearId();
    if (!yearId) {
        throw new Error("No academic year found and none provided.");
    }

    // Find the existing enrollment for the student in the specified academic year
    const enrollment = await prisma.enrollment.findUnique({
        where: {
            student_id_academic_year_id: {
                student_id: studentId,
                academic_year_id: yearId
            }
        },
        include: { sub_class: true }
    });

    if (!enrollment) {
        throw new Error(`Student with ID ${studentId} is not enrolled in academic year ${yearId}.`);
    }

    if (enrollment.sub_class_id !== null) {
        throw new Error(`Student with ID ${studentId} is already assigned to a subclass (${enrollment.sub_class?.name || enrollment.sub_class_id}) for academic year ${yearId}.`);
    }

    // Verify the subclass exists
    const subClass = await prisma.subClass.findUnique({
        where: { id: subClassId }
    });

    if (!subClass) {
        throw new Error(`Subclass with ID ${subClassId} not found.`);
    }

    // Update the enrollment with the new subclass ID
    const updatedEnrollment = await prisma.enrollment.update({
        where: {
            id: enrollment.id
        },
        data: {
            sub_class_id: subClassId,
            // status: 'ASSIGNED_TO_CLASS' as StudentStatus // Update student status if applicable
        },
        include: {
            student: true,
            sub_class: { include: { class: true } }
        }
    });

    // Optionally, update the student's main status if they were previously NOT_ENROLLED
    await prisma.student.update({
        where: { id: studentId },
        data: { status: StudentStatus.ASSIGNED_TO_CLASS }
    });

    return updatedEnrollment;
}

/**
 * Search students by name or matricule
 */
export async function searchStudents(
    searchQuery: string,
    academicYearId?: number,
    page: number = 1,
    limit: number = 10
): Promise<PaginatedResult<any>> {
    try {
        // Determine target academic year
        const targetAcademicYearId = academicYearId ?? await getAcademicYearId();

        // Tokenize so word order doesn't matter ("Smith John" matches "John Smith")
        const tokens = searchQuery.split(/\s+/).filter(t => t.length > 0);
        const buildTokenOr = (token: string): Prisma.StudentWhereInput => ({
            OR: [
                { name: { contains: token, mode: 'insensitive' } },
                { matricule: { contains: token, mode: 'insensitive' } },
                { place_of_birth: { contains: token, mode: 'insensitive' } },
                { residence: { contains: token, mode: 'insensitive' } },
                { former_school: { contains: token, mode: 'insensitive' } },
                { parents: { some: { parent: { name: { contains: token, mode: 'insensitive' } } } } },
                { parents: { some: { parent: { phone: { contains: token, mode: 'insensitive' } } } } },
                { parents: { some: { parent: { email: { contains: token, mode: 'insensitive' } } } } },
                { parents: { some: { parent: { matricule: { contains: token, mode: 'insensitive' } } } } },
                { enrollments: { some: { class: { name: { contains: token, mode: 'insensitive' } } } } },
                { enrollments: { some: { sub_class: { name: { contains: token, mode: 'insensitive' } } } } },
            ],
        });

        const searchCriteria: Prisma.StudentWhereInput = tokens.length > 0
            ? { AND: tokens.map(buildTokenOr) }
            : { OR: [{ name: { contains: searchQuery, mode: 'insensitive' } }] };

        // Count total matching students
        const total = await prisma.student.count({ where: searchCriteria });

        // Calculate pagination
        const skip = (page - 1) * limit;
        const totalPages = Math.ceil(total / limit);

        // Fetch students with pagination
        const students = await prisma.student.findMany({
            where: searchCriteria,
            skip,
            take: limit,
            orderBy: { name: 'asc' },
            include: {
                enrollments: targetAcademicYearId ? {
                    where: { academic_year_id: targetAcademicYearId },
                    include: {
                        sub_class: {
                            include: {
                                class: true
                            }
                        }
                    }
                } : undefined,
                parents: {
                    include: {
                        parent: true
                    }
                }
            }
        });

        return {
            data: students,
            meta: {
                total,
                page,
                limit,
                totalPages
            }
        };
    } catch (error) {
        console.error('Error searching students:', error);
        throw error;
    }
}


/**
 * Retrieves a student's data based on their enrollment ID.
 * @param enrollmentId The ID of the enrollment.
 * @returns The student object with their latest enrollment details.
 */
export async function getStudentByEnrollmentId(enrollmentId: number): Promise<any> {
    const enrollment = await prisma.enrollment.findUnique({
        where: { id: enrollmentId },
        include: {
            student: {
                include: {
                    parents: {
                        include: {
                            parent: true,
                        },
                    },
                },
            },
            sub_class: {
                include: {
                    class: true,
                },
            },
        },
    });

    if (!enrollment) {
        return null;
    }

    const { student, sub_class } = enrollment;

    return {
        ...student,
        class: sub_class?.class?.name || null,
        subClass: sub_class?.name || null,
    };
}

/**
 * Update enrollment photo for a student
 */
export async function updateEnrollmentPhoto(
    studentId: number,
    academicYearId: number,
    photoFilename: string
): Promise<any> {
    try {
        // Find the enrollment record
        const enrollment = await prisma.enrollment.findUnique({
            where: {
                student_id_academic_year_id: {
                    student_id: studentId,
                    academic_year_id: academicYearId
                }
            },
            include: {
                student: true,
                sub_class: {
                    include: {
                        class: true
                    }
                }
            }
        });

        if (!enrollment) {
            throw new Error(`No enrollment found for student ${studentId} in academic year ${academicYearId}`);
        }

        // Update the enrollment with the new photo
        const updatedEnrollment = await prisma.enrollment.update({
            where: { id: enrollment.id },
            data: { photo: photoFilename },
            include: {
                student: true,
                sub_class: {
                    include: {
                        class: true
                    }
                }
            }
        });

        return updatedEnrollment;
    } catch (error: any) {
        console.error('Error updating enrollment photo:', error);
        throw new Error(`Failed to update enrollment photo: ${error.message}`);
    }
}

/**
 * Get student enrollment photo information.
 *
 * Resolution order:
 *   1. Enrollment for the requested academic year (with a photo).
 *   2. Most recent prior-year enrollment that has a photo (so the student's photo
 *      keeps showing across years until a new one is uploaded for the current year).
 *   3. The student's own profile `photo` if any has been stored there.
 *   4. null when no photo exists anywhere.
 */
export async function getStudentEnrollmentPhoto(
    studentId: number,
    academicYearId: number
): Promise<{ photo: string | null; enrollmentId: number | null; sourceYearId?: number } | null> {
    try {
        const currentEnrollment = await prisma.enrollment.findUnique({
            where: {
                student_id_academic_year_id: {
                    student_id: studentId,
                    academic_year_id: academicYearId
                }
            },
            select: { id: true, photo: true }
        });

        if (currentEnrollment && currentEnrollment.photo) {
            return {
                photo: currentEnrollment.photo,
                enrollmentId: currentEnrollment.id,
                sourceYearId: academicYearId
            };
        }

        // Fall back to the most recent prior enrollment that has a photo.
        const previousEnrollment = await prisma.enrollment.findFirst({
            where: {
                student_id: studentId,
                photo: { not: null },
                NOT: { academic_year_id: academicYearId }
            },
            orderBy: { academic_year_id: 'desc' },
            select: { id: true, photo: true, academic_year_id: true }
        });

        if (previousEnrollment) {
            return {
                photo: previousEnrollment.photo,
                enrollmentId: previousEnrollment.id,
                sourceYearId: previousEnrollment.academic_year_id
            };
        }

        // If neither year has a photo, fall back to the student's own profile photo.
        const student = await prisma.student.findUnique({
            where: { id: studentId },
            select: { id: true }
        });
        if (!student) {
            return null;
        }

        // No photo anywhere — return the current-year enrollment id (if any) with null photo
        // so the caller can still distinguish "student exists" from "student not found".
        return {
            photo: null,
            enrollmentId: currentEnrollment ? currentEnrollment.id : null
        };
    } catch (error: any) {
        console.error('Error getting student enrollment photo:', error);
        throw new Error(`Failed to get enrollment photo: ${error.message}`);
    }
}

/**
 * Build the rows for a class list sheet from a set of enrollments.
 * Header columns: #, Matricule, Name, Gender, Date of Birth, Place of Birth,
 * Residence, Former School, New/Old, Repeater, Status.
 */
function buildClassListSheetRows(enrollments: any[]): string[][] {
    const header = [
        '#', 'Matricule', 'Name', 'Gender', 'Date of Birth',
        'Place of Birth', 'Residence', 'Former School',
        'New/Old', 'Repeater', 'Status'
    ];
    const rows: string[][] = [header];
    const sorted = [...enrollments].sort((a, b) =>
        (a.student?.name || '').localeCompare(b.student?.name || '')
    );
    sorted.forEach((e, idx) => {
        const s = e.student || {};
        rows.push([
            String(idx + 1),
            s.matricule || '',
            s.name || '',
            s.gender || '',
            s.date_of_birth ? new Date(s.date_of_birth).toISOString().slice(0, 10) : '',
            s.place_of_birth || '',
            s.residence || '',
            s.former_school || '',
            s.is_new_student ? 'NEW' : 'OLD',
            e.repeater ? 'YES' : 'NO',
            s.status || ''
        ]);
    });
    return rows;
}

/**
 * Export a single subclass's student list as an .xlsx file.
 */
export async function exportSubclassStudentListExcel(
    subClassId: number,
    academicYearId?: number
): Promise<{ buffer: Buffer; filename: string }> {
    const yearId = await getAcademicYearId(academicYearId);
    if (!yearId) {
        throw new Error('No academic year found');
    }

    const subClass = await prisma.subClass.findUnique({
        where: { id: subClassId },
        include: { class: true }
    });
    if (!subClass) {
        throw new Error(`Subclass with ID ${subClassId} not found`);
    }

    const enrollments = await prisma.enrollment.findMany({
        where: { sub_class_id: subClassId, academic_year_id: yearId },
        include: { student: true }
    });

    const workbook = XLSX.utils.book_new();
    const rows = buildClassListSheetRows(enrollments);
    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    worksheet['!cols'] = rows[0].map((_, i) => ({
        wch: i === 0 ? 5 : i === 2 ? 30 : 20
    }));
    const sheetName = `${subClass.class.name} - ${subClass.name}`.substring(0, 31);
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const filename = `class_list_${subClass.class.name}_${subClass.name}`
        .replace(/\s+/g, '_') + '.xlsx';
    return { buffer, filename };
}

/**
 * Export a class's student list as an .xlsx file with one sheet per subclass.
 */
export async function exportClassStudentListExcel(
    classId: number,
    academicYearId?: number
): Promise<{ buffer: Buffer; filename: string }> {
    const yearId = await getAcademicYearId(academicYearId);
    if (!yearId) {
        throw new Error('No academic year found');
    }

    const klass = await prisma.class.findUnique({
        where: { id: classId },
        include: {
            sub_classes: {
                orderBy: { name: 'asc' },
                include: {
                    enrollments: {
                        where: { academic_year_id: yearId },
                        include: { student: true }
                    }
                }
            }
        }
    });
    if (!klass) {
        throw new Error(`Class with ID ${classId} not found`);
    }

    const workbook = XLSX.utils.book_new();

    if (klass.sub_classes.length === 0) {
        const worksheet = XLSX.utils.aoa_to_sheet([['No subclasses for this class']]);
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Empty');
    } else {
        for (const sub of klass.sub_classes) {
            const rows = buildClassListSheetRows(sub.enrollments);
            const worksheet = XLSX.utils.aoa_to_sheet(rows);
            worksheet['!cols'] = rows[0].map((_, i) => ({
                wch: i === 0 ? 5 : i === 2 ? 30 : 20
            }));
            const sheetName = `${klass.name} - ${sub.name}`.substring(0, 31);
            XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
        }
    }

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const filename = `class_list_${klass.name}`.replace(/\s+/g, '_') + '.xlsx';
    return { buffer, filename };
}

/**
 * PDF class-list rendering.
 * Lays out one table per (sub)class on landscape A4 pages with a header,
 * paginates rows, and returns the assembled Buffer.
 */
type ClassListSection = {
    title: string;
    enrollments: any[];
};

function sanitizeForPdf(text: string): string {
    // pdf-lib StandardFonts only support WinAnsi (Latin-1) — strip what it can't render.
    return (text || '')
        .replace(/[ -]/g, ' ')
        .replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');
}

function formatParentsContact(parents?: any[]): string {
    if (!Array.isArray(parents) || parents.length === 0) return '';
    return parents
        .map(link => {
            const p = link?.parent || {};
            const phone = p.phone || p.whatsapp_number || '';
            if (!phone) return '';
            const label = link?.relationship
                ? String(link.relationship).charAt(0) + String(link.relationship).slice(1).toLowerCase()
                : (p.name ? String(p.name).split(' ')[0] : 'Parent');
            return `${label}: ${phone}`;
        })
        .filter(Boolean)
        .join(' | ');
}

function drawClassListHeader(
    page: PDFPage,
    boldFont: PDFFont,
    font: PDFFont,
    title: string,
    yearLabel: string,
    pageWidth: number,
    pageHeight: number,
    margin: number
): number {
    const titleSize = 14;
    const subSize = 9;
    page.drawText(sanitizeForPdf(title), {
        x: margin,
        y: pageHeight - margin - titleSize,
        size: titleSize,
        font: boldFont,
        color: rgb(0, 0.35, 0.6),
    });
    const generated = `Generated ${new Date().toLocaleDateString('en-GB')}  -  Academic Year ${yearLabel}`;
    page.drawText(sanitizeForPdf(generated), {
        x: margin,
        y: pageHeight - margin - titleSize - subSize - 4,
        size: subSize,
        font,
        color: rgb(0.4, 0.4, 0.4),
    });
    return pageHeight - margin - titleSize - subSize - 24; // y where the table starts
}

async function buildClassListPdfBuffer(
    sections: ClassListSection[],
    documentTitle: string,
    yearLabel: string
): Promise<Buffer> {
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const [pageW, pageH] = PageSizes.A4;
    // Landscape to fit the wider table
    const pageWidth = pageH;
    const pageHeight = pageW;
    const margin = 24;
    const rowHeight = 18;
    const headerRowHeight = 22;
    const fontSize = 8;

    const columns = [
        { key: '#', width: 20 },
        { key: 'Matricule', width: 65 },
        { key: 'Nom', width: 85 },
        { key: 'Prenom', width: 85 },
        { key: 'Gender', width: 30 },
        { key: 'DOB', width: 55 },
        { key: 'Place of Birth', width: 65 },
        { key: 'Residence', width: 60 },
        { key: 'New/Old', width: 32 },
        { key: 'Repeater', width: 32 },
        { key: 'Ream', width: 30 },
        { key: 'Parents Contact', width: 200 },
    ];

    const drawRow = (page: PDFPage, y: number, values: string[], opts: { bold?: boolean; fill?: boolean }) => {
        let x = margin;
        if (opts.fill) {
            page.drawRectangle({
                x: margin,
                y,
                width: columns.reduce((s, c) => s + c.width, 0),
                height: headerRowHeight,
                color: rgb(0.92, 0.94, 0.98),
            });
        }
        columns.forEach((col, i) => {
            page.drawRectangle({
                x,
                y,
                width: col.width,
                height: opts.bold ? headerRowHeight : rowHeight,
                borderColor: rgb(0.7, 0.7, 0.7),
                borderWidth: 0.5,
            });
            // Truncate text to fit the column
            let text = sanitizeForPdf(values[i] ?? '');
            const useFont = opts.bold ? boldFont : font;
            const maxWidth = col.width - 6;
            while (useFont.widthOfTextAtSize(text, fontSize) > maxWidth && text.length > 1) {
                text = text.slice(0, -1);
            }
            page.drawText(text, {
                x: x + 3,
                y: y + (opts.bold ? 7 : 5),
                size: fontSize,
                font: useFont,
                color: rgb(0, 0, 0),
            });
            x += col.width;
        });
    };

    let page = pdfDoc.addPage([pageWidth, pageHeight]);
    let y = drawClassListHeader(page, boldFont, font, documentTitle, yearLabel, pageWidth, pageHeight, margin);

    for (const section of sections) {
        // Section title
        if (y < margin + 80) {
            page = pdfDoc.addPage([pageWidth, pageHeight]);
            y = drawClassListHeader(page, boldFont, font, documentTitle, yearLabel, pageWidth, pageHeight, margin);
        }
        page.drawText(sanitizeForPdf(section.title), {
            x: margin,
            y: y - 4,
            size: 11,
            font: boldFont,
            color: rgb(0.1, 0.1, 0.1),
        });
        y -= 22;

        // Table header row
        const headerY = y - headerRowHeight;
        drawRow(page, headerY, columns.map(c => c.key), { bold: true, fill: true });
        y = headerY;

        const sorted = [...section.enrollments].sort((a, b) => {
            const an = `${a.student?.nom || ''} ${a.student?.prenom || ''}`.trim() || (a.student?.name || '');
            const bn = `${b.student?.nom || ''} ${b.student?.prenom || ''}`.trim() || (b.student?.name || '');
            return an.localeCompare(bn);
        });

        if (sorted.length === 0) {
            const rowY = y - rowHeight;
            page.drawRectangle({
                x: margin,
                y: rowY,
                width: columns.reduce((s, c) => s + c.width, 0),
                height: rowHeight,
                borderColor: rgb(0.7, 0.7, 0.7),
                borderWidth: 0.5,
            });
            page.drawText(sanitizeForPdf('No students enrolled'), {
                x: margin + 6,
                y: rowY + 5,
                size: fontSize,
                font,
                color: rgb(0.5, 0.5, 0.5),
            });
            y = rowY - 10;
            continue;
        }

        sorted.forEach((e, idx) => {
            // Paginate
            if (y - rowHeight < margin) {
                page = pdfDoc.addPage([pageWidth, pageHeight]);
                y = drawClassListHeader(page, boldFont, font, documentTitle, yearLabel, pageWidth, pageHeight, margin);
                const hY = y - headerRowHeight;
                drawRow(page, hY, columns.map(c => c.key), { bold: true, fill: true });
                y = hY;
            }
            const s = e.student || {};
            const nomVal = s.nom || (s.name ? String(s.name).split(' ')[0] : '');
            const prenomVal = s.prenom || (s.name ? String(s.name).split(' ').slice(1).join(' ') : '');
            const rowY = y - rowHeight;
            drawRow(page, rowY, [
                String(idx + 1),
                s.matricule || '',
                nomVal,
                prenomVal,
                s.gender || '',
                s.date_of_birth ? new Date(s.date_of_birth).toISOString().slice(0, 10) : '',
                s.place_of_birth || '',
                s.residence || '',
                s.is_new_student ? 'NEW' : 'OLD',
                e.repeater ? 'YES' : 'NO',
                e.ream_of_paper_collected ? 'YES' : 'NO',
                formatParentsContact(s.parents),
            ], { bold: false });
            y = rowY;
        });

        y -= 18; // gap between sections
    }

    const bytes = await pdfDoc.save();
    return Buffer.from(bytes);
}

/**
 * Export a single subclass's student list as a PDF.
 */
export async function exportSubclassStudentListPdf(
    subClassId: number,
    academicYearId?: number
): Promise<{ buffer: Buffer; filename: string }> {
    const yearId = await getAcademicYearId(academicYearId);
    if (!yearId) {
        throw new Error('No academic year found');
    }

    const subClass = await prisma.subClass.findUnique({
        where: { id: subClassId },
        include: { class: true }
    });
    if (!subClass) {
        throw new Error(`Subclass with ID ${subClassId} not found`);
    }

    const enrollments = await prisma.enrollment.findMany({
        where: { sub_class_id: subClassId, academic_year_id: yearId },
        include: {
            student: {
                include: {
                    parents: {
                        include: {
                            parent: { select: { name: true, phone: true, whatsapp_number: true } }
                        }
                    }
                }
            }
        }
    });

    const year = await prisma.academicYear.findUnique({ where: { id: yearId }, select: { name: true } });
    const yearLabel = year?.name || String(yearId);

    const buffer = await buildClassListPdfBuffer(
        [{ title: `${subClass.class.name} - ${subClass.name}`, enrollments }],
        `Class List: ${subClass.class.name} - ${subClass.name}`,
        yearLabel
    );
    const filename = `class_list_${subClass.class.name}_${subClass.name}`
        .replace(/\s+/g, '_') + '.pdf';
    return { buffer, filename };
}

/**
 * Export a class's student list as a PDF, with one section per subclass.
 */
export async function exportClassStudentListPdf(
    classId: number,
    academicYearId?: number
): Promise<{ buffer: Buffer; filename: string }> {
    const yearId = await getAcademicYearId(academicYearId);
    if (!yearId) {
        throw new Error('No academic year found');
    }

    const klass = await prisma.class.findUnique({
        where: { id: classId },
        include: {
            sub_classes: {
                orderBy: { name: 'asc' },
                include: {
                    enrollments: {
                        where: { academic_year_id: yearId },
                        include: {
                            student: {
                                include: {
                                    parents: {
                                        include: {
                                            parent: { select: { name: true, phone: true, whatsapp_number: true } }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    });
    if (!klass) {
        throw new Error(`Class with ID ${classId} not found`);
    }

    const year = await prisma.academicYear.findUnique({ where: { id: yearId }, select: { name: true } });
    const yearLabel = year?.name || String(yearId);

    const sections: ClassListSection[] = klass.sub_classes.length > 0
        ? klass.sub_classes.map(sub => ({
            title: `${klass.name} - ${sub.name}`,
            enrollments: sub.enrollments
        }))
        : [{ title: klass.name, enrollments: [] }];

    const buffer = await buildClassListPdfBuffer(
        sections,
        `Class List: ${klass.name}`,
        yearLabel
    );
    const filename = `class_list_${klass.name}`.replace(/\s+/g, '_') + '.pdf';
    return { buffer, filename };
}

export type PromotionDecision = 'PROMOTE' | 'REPEAT' | 'GRADUATE' | 'NEEDS_DECISION' | 'NO_AVERAGE';

export interface PromotionPreviewItem {
    student_id: number;
    student_name: string;
    matricule: string;
    current_enrollment_id: number;
    current_class_id: number;
    current_class_name: string;
    annual_average: number | null;
    pass_mark: number;
    decision: PromotionDecision;
    suggested_target_class_id: number | null;
    suggested_target_class_name: string | null;
    sequences_counted: number;
    already_promoted: boolean;
}

export async function getPromotionPreview(
    fromAcademicYearId: number,
    toAcademicYearId: number
): Promise<PromotionPreviewItem[]> {
    if (fromAcademicYearId === toAcademicYearId) {
        throw new Error('fromAcademicYearId and toAcademicYearId must be different');
    }

    const enrollments = await prisma.enrollment.findMany({
        where: { academic_year_id: fromAcademicYearId },
        include: {
            student: true,
            class: { include: { next_class: true } },
            student_sequence_averages: { select: { average: true } },
        },
        orderBy: [{ class_id: 'asc' }, { student: { name: 'asc' } }],
    });

    const studentIds = enrollments.map(e => e.student_id);
    const existingNextYear = await prisma.enrollment.findMany({
        where: { academic_year_id: toAcademicYearId, student_id: { in: studentIds } },
        select: { student_id: true },
    });
    const alreadyPromoted = new Set(existingNextYear.map(e => e.student_id));

    return enrollments.map(en => {
        const sequences = en.student_sequence_averages;
        const annualAverage = sequences.length > 0
            ? sequences.reduce((sum, s) => sum + s.average, 0) / sequences.length
            : null;

        let decision: PromotionDecision;
        let targetClassId: number | null = null;
        let targetClassName: string | null = null;

        if (annualAverage === null) {
            decision = 'NO_AVERAGE';
        } else if (annualAverage < en.class.pass_mark) {
            decision = 'REPEAT';
            targetClassId = en.class.id;
            targetClassName = en.class.name;
        } else if (en.class.next_class_id === null) {
            // Terminal: UPPER SIXTH = graduate; FORM 5 = needs manual choice
            const isUpperSixth = en.class.name.toUpperCase().includes('UPPER SIXTH');
            decision = isUpperSixth ? 'GRADUATE' : 'NEEDS_DECISION';
        } else {
            decision = 'PROMOTE';
            targetClassId = en.class.next_class_id;
            targetClassName = en.class.next_class?.name ?? null;
        }

        return {
            student_id: en.student_id,
            student_name: en.student.name,
            matricule: en.student.matricule,
            current_enrollment_id: en.id,
            current_class_id: en.class.id,
            current_class_name: en.class.name,
            annual_average: annualAverage,
            pass_mark: en.class.pass_mark,
            decision,
            suggested_target_class_id: targetClassId,
            suggested_target_class_name: targetClassName,
            sequences_counted: sequences.length,
            already_promoted: alreadyPromoted.has(en.student_id),
        };
    });
}

export interface PromotionInput {
    student_id: number;
    target_class_id?: number | null; // required unless action = GRADUATE
    repeater?: boolean;
    action: 'PROMOTE' | 'REPEAT' | 'GRADUATE' | 'TRANSFER';
}

export interface PromotionResult {
    student_id: number;
    success: boolean;
    enrollment_id?: number;
    error?: string;
}

export async function promoteStudents(
    fromAcademicYearId: number,
    toAcademicYearId: number,
    promotions: PromotionInput[]
): Promise<PromotionResult[]> {
    if (fromAcademicYearId === toAcademicYearId) {
        throw new Error('fromAcademicYearId and toAcademicYearId must be different');
    }

    const toYear = await prisma.academicYear.findUnique({ where: { id: toAcademicYearId } });
    if (!toYear) {
        throw new Error(`Target academic year ${toAcademicYearId} not found`);
    }

    const results: PromotionResult[] = [];

    for (const p of promotions) {
        try {
            if (p.action === 'GRADUATE' || p.action === 'TRANSFER') {
                await prisma.student.update({
                    where: { id: p.student_id },
                    data: { status: p.action === 'GRADUATE' ? StudentStatus.GRADUATED : StudentStatus.TRANSFERRED },
                });
                results.push({ student_id: p.student_id, success: true });
                continue;
            }

            if (!p.target_class_id) {
                throw new Error('target_class_id is required for PROMOTE/REPEAT');
            }

            const existing = await prisma.enrollment.findUnique({
                where: {
                    student_id_academic_year_id: {
                        student_id: p.student_id,
                        academic_year_id: toAcademicYearId,
                    },
                },
            });
            if (existing) {
                throw new Error('Student already has an enrollment in the target academic year');
            }

            const enrollment = await prisma.enrollment.create({
                data: {
                    student_id: p.student_id,
                    academic_year_id: toAcademicYearId,
                    class_id: p.target_class_id,
                    sub_class_id: null,
                    repeater: p.action === 'REPEAT' ? true : (p.repeater ?? false),
                },
            });

            await feeService.createOrUpdateFeeForEnrollment(enrollment.id, p.target_class_id);
            await updateNewStudentStatus(p.student_id);

            results.push({ student_id: p.student_id, success: true, enrollment_id: enrollment.id });
        } catch (err: any) {
            results.push({ student_id: p.student_id, success: false, error: err.message });
        }
    }

    return results;
}

// Unenroll a student from a specific academic year (defaults to current year).
// Refuses if the enrollment has any dependent academic/financial records, to preserve history.
export async function unenrollStudent(
    studentId: number,
    academicYearId?: number
): Promise<{ student_id: number; academic_year_id: number }> {
    const student = await prisma.student.findUnique({ where: { id: studentId } });
    if (!student) {
        throw new Error('STUDENT_NOT_FOUND');
    }

    const yearId = academicYearId ?? await getAcademicYearId();
    if (!yearId) {
        throw new Error('ACADEMIC_YEAR_NOT_FOUND');
    }

    const enrollment = await prisma.enrollment.findUnique({
        where: { student_id_academic_year_id: { student_id: studentId, academic_year_id: yearId } },
        include: {
            _count: {
                select: {
                    marks: true,
                    school_fees: true,
                    payment_transactions: true,
                    control_school_fees: true,
                    control_payment_transactions: true,
                    discipline_issues: true,
                    absences: true,
                    student_sequence_averages: true,
                    fee_item_payments: true,
                    refunds: true,
                    saturday_punishments: true,
                    broken_properties: true,
                    disciplinary_actions: true,
                },
            },
        },
    });

    if (!enrollment) {
        throw new Error('ENROLLMENT_NOT_FOUND');
    }

    const counts = enrollment._count;
    const hasAcademicRecords =
        counts.marks > 0 ||
        counts.student_sequence_averages > 0 ||
        counts.discipline_issues > 0 ||
        counts.absences > 0 ||
        counts.saturday_punishments > 0 ||
        counts.broken_properties > 0 ||
        counts.disciplinary_actions > 0;

    const hasFinancialRecords =
        counts.payment_transactions > 0 ||
        counts.control_payment_transactions > 0 ||
        counts.fee_item_payments > 0 ||
        counts.refunds > 0;

    if (hasAcademicRecords) {
        throw new Error('ENROLLMENT_HAS_ACADEMIC_RECORDS');
    }
    if (hasFinancialRecords) {
        throw new Error('ENROLLMENT_HAS_FINANCIAL_RECORDS');
    }

    await prisma.$transaction(async (tx) => {
        // Clean up fee scaffolding that has no payments attached
        await tx.schoolFees.deleteMany({ where: { enrollment_id: enrollment.id } });
        await tx.controlSchoolFees.deleteMany({ where: { enrollment_id: enrollment.id } });

        await tx.enrollment.delete({ where: { id: enrollment.id } });

        // Reset student status if they have no remaining enrollments
        const remaining = await tx.enrollment.count({ where: { student_id: studentId } });
        if (remaining === 0) {
            await tx.student.update({
                where: { id: studentId },
                data: { status: StudentStatus.NOT_ENROLLED },
            });
        }
    });

    return { student_id: studentId, academic_year_id: yearId };
}

// Soft-delete: marks the student WITHDRAWN instead of hard-deleting the row
// and its ~18 tables of dependent data.
//
// This used to be a real DELETE, cascaded by hand across every dependent
// table. The sync system (src/sync) only replicates creates/updates -- it
// has no concept of a deletion -- so a student removed on one node was
// invisible to that fact everywhere else, and the very next sync tick
// re-created it (and its enrollment, fees, attendance...) from whichever
// node still had the row. On a bidirectional 5-minute loop that meant a
// deletion essentially never stuck unless done on both databases inside the
// same window. A status change is an ordinary field update, which the
// existing sync path already replicates correctly in both directions, so
// withdrawal now behaves the same as any other edit instead of needing sync
// support it was never given.
//
// Dependent data (fees, payments, attendance, discipline history) is left
// in place rather than deleted -- it's the paper trail for *why* the
// student was withdrawn (unpaid fees, absences) and callers that list
// "active" students already filter on status: ENROLLED.
export async function deleteStudent(studentId: number, actorUserId: number): Promise<void> {
    const student = await prisma.student.findUnique({ where: { id: studentId } });
    if (!student) {
        throw new Error('STUDENT_NOT_FOUND');
    }

    await prisma.student.update({
        where: { id: studentId },
        data: { status: StudentStatus.WITHDRAWN },
    });

    await createAuditLog({
        userId: actorUserId,
        action: 'WITHDRAW',
        entityType: 'Student',
        entityId: studentId,
        changes: { oldValues: { status: student.status }, newValues: { status: StudentStatus.WITHDRAWN } },
        description: `Student ${student.matricule ?? studentId} withdrawn (soft delete, replaces hard delete)`,
        severity: 'MEDIUM',
    });
}

// ---------------------------------------------------------------------------
// Discipline / profile extensions
// ---------------------------------------------------------------------------

/**
 * Return every other student who shares at least one parent with this student.
 * Includes each sibling's current-year enrollment (sub_class + class) plus the
 * shared parent relationships used to identify them.
 */
export async function getStudentSiblings(studentId: number): Promise<any[]> {
    const target = await prisma.student.findUnique({
        where: { id: studentId },
        select: { id: true },
    });
    if (!target) {
        throw new Error('STUDENT_NOT_FOUND');
    }

    const parentLinks = await prisma.parentStudent.findMany({
        where: { student_id: studentId },
        select: { parent_id: true, relationship: true },
    });
    if (parentLinks.length === 0) return [];

    const parentIds = parentLinks.map((p) => p.parent_id);
    const relationshipByParent = new Map(parentLinks.map((p) => [p.parent_id, p.relationship]));

    const currentYearId = await getAcademicYearId();

    const siblingLinks = await prisma.parentStudent.findMany({
        where: {
            parent_id: { in: parentIds },
            student_id: { not: studentId },
        },
        include: {
            parent: { select: { id: true, name: true, email: true, phone: true } },
            student: {
                include: {
                    enrollments: currentYearId
                        ? {
                              where: { academic_year_id: currentYearId },
                              include: {
                                  academic_year: true,
                                  class: true,
                                  sub_class: { include: { class: true } },
                              },
                          }
                        : false,
                },
            },
        },
    });

    const bySiblingId = new Map<number, any>();
    for (const link of siblingLinks) {
        const sib = link.student;
        if (!sib) continue;
        const existing = bySiblingId.get(sib.id) || {
            student: sib,
            current_enrollment: sib.enrollments && sib.enrollments[0] ? sib.enrollments[0] : null,
            shared_parents: [] as Array<{ parent: any; sibling_relationship: string | null; target_relationship: string | null }>,
        };
        existing.shared_parents.push({
            parent: link.parent,
            sibling_relationship: link.relationship ?? null,
            target_relationship: relationshipByParent.get(link.parent_id) ?? null,
        });
        bySiblingId.set(sib.id, existing);
    }

    return Array.from(bySiblingId.values());
}

export async function listPreviousSchools(studentId: number) {
    const student = await prisma.student.findUnique({ where: { id: studentId }, select: { id: true } });
    if (!student) throw new Error('STUDENT_NOT_FOUND');
    return prisma.studentPreviousSchool.findMany({
        where: { student_id: studentId },
        orderBy: { id: 'asc' },
    });
}

export async function addPreviousSchool(
    studentId: number,
    data: { school_name: string; from_year?: string; to_year?: string; notes?: string }
) {
    const student = await prisma.student.findUnique({ where: { id: studentId }, select: { id: true } });
    if (!student) throw new Error('STUDENT_NOT_FOUND');
    if (!data.school_name || data.school_name.trim().length === 0) {
        throw new Error('school_name is required');
    }
    return prisma.studentPreviousSchool.create({
        data: {
            student_id: studentId,
            school_name: data.school_name.trim(),
            from_year: data.from_year?.trim() || null,
            to_year: data.to_year?.trim() || null,
            notes: data.notes?.trim() || null,
        },
    });
}

export async function updatePreviousSchool(
    studentId: number,
    previousSchoolId: number,
    data: { school_name?: string; from_year?: string; to_year?: string; notes?: string }
) {
    const existing = await prisma.studentPreviousSchool.findUnique({
        where: { id: previousSchoolId },
    });
    if (!existing || existing.student_id !== studentId) {
        throw new Error('PREVIOUS_SCHOOL_NOT_FOUND');
    }
    return prisma.studentPreviousSchool.update({
        where: { id: previousSchoolId },
        data: {
            school_name: data.school_name !== undefined ? data.school_name.trim() : undefined,
            from_year: data.from_year !== undefined ? (data.from_year?.trim() || null) : undefined,
            to_year: data.to_year !== undefined ? (data.to_year?.trim() || null) : undefined,
            notes: data.notes !== undefined ? (data.notes?.trim() || null) : undefined,
        },
    });
}

export async function deletePreviousSchool(studentId: number, previousSchoolId: number) {
    const existing = await prisma.studentPreviousSchool.findUnique({
        where: { id: previousSchoolId },
    });
    if (!existing || existing.student_id !== studentId) {
        throw new Error('PREVIOUS_SCHOOL_NOT_FOUND');
    }
    await prisma.studentPreviousSchool.delete({ where: { id: previousSchoolId } });
}
