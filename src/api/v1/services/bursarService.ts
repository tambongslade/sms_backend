import prisma from '../../../config/db';
import { getCurrentAcademicYear } from '../../../utils/academicYear';
import { generateStaffMatricule } from '../../../utils/matriculeGenerator';
import { StudentStatus, Gender, Role, Relationship } from '@prisma/client';
import bcrypt from 'bcrypt';
import { updateNewStudentStatus } from '../../../utils/studentStatus';
import { normalizeRelationship } from './studentService';

// Types for bursar operations
export interface ParentContactInput {
    name: string;
    phone: string;
    phone_is_whatsapp?: boolean; // If true, copy phone -> whatsapp_number
    whatsapp?: string;
    address?: string; // optional
    relationship?: string; // FATHER, MOTHER, SIBLING, GUARDIAN
}

export interface StudentWithParentData {
    // Student information (legacy student_name kept for backward compat — prefer nom + prenom)
    student_name?: string;
    student_nom?: string;
    student_prenom?: string;
    date_of_birth: string;
    place_of_birth: string;
    gender: Gender;
    residence: string;
    former_school?: string;
    class_id: number;
    is_new_student?: boolean;
    academic_year_id?: number;
    ream_of_paper_collected?: boolean;

    // Up to two parent contacts (first required, second optional).
    parents?: ParentContactInput[];

    // Legacy single-parent fields (kept for backward compat — used when `parents` is absent).
    parent_name?: string;
    parent_phone?: string;
    parent_phone_is_whatsapp?: boolean;
    parent_whatsapp?: string;
    parent_address?: string; // optional
    relationship?: string;
}

export interface LinkExistingParentData {
    student_id: number;
    parent_id: number;
    relationship?: string;
}

export interface ParentSearchResult {
    id: number;
    name: string;
    email: string;
    phone: string;
    matricule: string;
    children_count: number;
    children: Array<{
        id: number;
        name: string;
        matricule: string;
        class_name?: string;
    }>;
}

export interface RegistrationParent {
    id: number;
    matricule: string;
    name: string;
    phone: string;
    whatsapp_number: string | null;
    relationship: string | null;
}

export interface RegistrationResult {
    student: {
        id: number;
        matricule: string;
        name: string;
        status: string;
    };
    parent: RegistrationParent & { temporary_password: string };
    parents: RegistrationParent[];
    enrollment: {
        id: number;
        class_name: string;
        status: string;
    };
    fee_record?: {
        id: number;
        amount_expected: number;
    };
}

/**
 * Create a student with automatic parent account creation
 * This is the main Bursar function for registering new students
 */
export async function createStudentWithParent(data: StudentWithParentData): Promise<RegistrationResult> {
    try {
        const yearId = data.academic_year_id || (await getCurrentAcademicYear())?.id;
        if (!yearId) {
            throw new Error('No current academic year found and none provided.');
        }

        // Check if class exists and get its base fee
        const classExists = await prisma.class.findUnique({
            where: { id: data.class_id },
            select: { id: true, name: true, base_fee: true }
        });
        if (!classExists) {
            throw new Error(`Class with ID ${data.class_id} not found.`);
        }

        // Derive student name from nom + prenom, falling back to legacy student_name
        const nom = data.student_nom?.trim();
        const prenom = data.student_prenom?.trim();
        const studentFullName = (nom && prenom) ? `${nom} ${prenom}` : (data.student_name?.trim() || '');
        if (!studentFullName) {
            throw new Error('Provide student nom (family name) and prenom (given name).');
        }

        const isNewStudent = data.is_new_student ?? true;
        // Ream of paper only applies to new students; default false otherwise.
        const reamCollected = isNewStudent ? !!data.ream_of_paper_collected : false;

        // Build the list of parent contacts. Accept either the new `parents[]` array
        // or fall back to the legacy single-parent fields. First is required, second optional.
        const parentInputs: ParentContactInput[] = (data.parents && data.parents.length > 0)
            ? data.parents
            : (data.parent_name && data.parent_phone ? [{
                name: data.parent_name,
                phone: data.parent_phone,
                phone_is_whatsapp: data.parent_phone_is_whatsapp,
                whatsapp: data.parent_whatsapp,
                address: data.parent_address,
                relationship: data.relationship
            }] : []);

        if (parentInputs.length === 0) {
            throw new Error('At least one parent contact is required.');
        }
        if (parentInputs.length > 2) {
            throw new Error('At most two parent contacts are allowed.');
        }
        parentInputs.forEach((p, i) => {
            if (!p.name?.trim() || !p.phone?.trim()) {
                throw new Error(`Parent #${i + 1} requires name and phone.`);
            }
        });

        // Generate matricule for student
        const studentMatricule = await generateStaffMatricule([]);

        // Pre-generate one matricule per parent before opening the transaction.
        // generateStaffMatricule reads via the global prisma client, so calling it
        // twice inside the same transaction would return the same value (the first
        // parent's row is not yet committed and therefore invisible to the second
        // lookup) and hit a unique-constraint violation. Generate them here and
        // bump the counter locally when a candidate collides with one already
        // reserved for this batch.
        const parentMatricules: string[] = [];
        for (let i = 0; i < parentInputs.length; i++) {
            let candidate = await generateStaffMatricule([Role.PARENT]);
            while (parentMatricules.includes(candidate)) {
                const prefix = candidate.slice(0, -4);
                const nextNum = parseInt(candidate.slice(-4), 10) + 1;
                if (nextNum > 9999) {
                    throw new Error(`Maximum parent matricule number (9999) reached for prefix ${prefix}`);
                }
                candidate = `${prefix}${nextNum.toString().padStart(4, '0')}`;
            }
            parentMatricules.push(candidate);
        }

        // Hash password for parent (shared default; sent back per parent for handover).
        // must_change_password=true is set on the user so the parent is forced to
        // pick a private password on their very first sign-in.
        const hashedPassword = await bcrypt.hash('password123', 10);

        const result = await prisma.$transaction(async (tx) => {
            // 1. Create student
            const student = await tx.student.create({
                data: {
                    matricule: studentMatricule,
                    name: studentFullName,
                    nom: nom || null,
                    prenom: prenom || null,
                    date_of_birth: new Date(data.date_of_birth),
                    place_of_birth: data.place_of_birth,
                    gender: data.gender.charAt(0).toUpperCase() + data.gender.slice(1).toLowerCase() as Gender,
                    residence: data.residence,
                    former_school: data.former_school,
                    is_new_student: isNewStudent,
                    status: StudentStatus.NOT_ENROLLED
                }
            });

            // 2. Create each parent user, role, and link.
            const parentsCreated: Array<{
                id: number;
                matricule: string;
                name: string;
                phone: string;
                whatsapp_number: string | null;
                relationship: string | null;
            }> = [];

            for (let i = 0; i < parentInputs.length; i++) {
                const p = parentInputs[i];
                const parentWhatsapp = p.phone_is_whatsapp
                    ? p.phone.trim()
                    : (p.whatsapp?.trim() || null);
                // Email is no longer collected from the user — generate a deterministic
                // placeholder so the unique-required column keeps working. Phone is unique
                // enough across parents that this collides only on duplicate phone numbers,
                // which is correct behavior (don't create two accounts for the same number).
                const generatedEmail = `parent.${p.phone.replace(/[^\d+]/g, '')}.${student.id}.${parentsCreated.length}@school.local`;

                const parentMatricule = parentMatricules[i];
                const parentUser = await tx.user.create({
                    data: {
                        name: p.name.trim(),
                        email: generatedEmail,
                        phone: p.phone.trim(),
                        whatsapp_number: parentWhatsapp,
                        // Address is no longer collected; column is required so default to empty.
                        address: p.address?.trim() || '',
                        password: hashedPassword,
                        must_change_password: true,
                        gender: Gender.Male, // Default, editable later
                        date_of_birth: new Date('1980-01-01'),
                        matricule: parentMatricule
                    }
                });

                await tx.userRole.create({
                    data: {
                        user_id: parentUser.id,
                        role: Role.PARENT,
                        academic_year_id: yearId
                    }
                });

                const relationshipEnum = normalizeRelationship(p.relationship);
                await tx.parentStudent.create({
                    data: {
                        parent_id: parentUser.id,
                        student_id: student.id,
                        ...(relationshipEnum ? { relationship: relationshipEnum as Relationship } : {})
                    }
                });

                parentsCreated.push({
                    id: parentUser.id,
                    matricule: parentUser.matricule || '',
                    name: parentUser.name,
                    phone: parentUser.phone,
                    whatsapp_number: parentUser.whatsapp_number,
                    relationship: relationshipEnum ?? null
                });
            }

            // 3. Create enrollment
            const enrollment = await tx.enrollment.create({
                data: {
                    student_id: student.id,
                    class_id: data.class_id,
                    academic_year_id: yearId,
                    repeater: false,
                    ream_of_paper_collected: reamCollected
                }
            });

            // 4. Create initial fee record if class has base fee
            let feeRecord = null;
            if (classExists.base_fee && classExists.base_fee > 0) {
                feeRecord = await tx.schoolFees.create({
                    data: {
                        enrollment_id: enrollment.id,
                        amount_expected: classExists.base_fee,
                        amount_paid: 0,
                        due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                        academic_year_id: yearId
                    }
                });
            }

            return {
                student: {
                    id: student.id,
                    matricule: student.matricule,
                    name: student.name,
                    status: student.status
                },
                // Primary parent kept for callers that still expect a single `parent` field.
                parent: {
                    ...parentsCreated[0],
                    temporary_password: 'password123'
                },
                parents: parentsCreated,
                enrollment: {
                    id: enrollment.id,
                    class_name: classExists.name,
                    status: 'CREATED'
                },
                fee_record: feeRecord ? {
                    id: feeRecord.id,
                    amount_expected: feeRecord.amount_expected
                } : undefined
            };
        });

        // Update is_new_student field based on enrollment history (after transaction)
        await updateNewStudentStatus(result.student.id);

        return result;
    } catch (error) {
        console.error('Error creating student with parent:', error);
        throw error;
    }
}

/**
 * Create a brand-new parent account and link it to an existing student.
 * Used by the edit-student flow when the secretary needs to add a new
 * contact for a student that has already been registered.
 */
export interface CreateParentForStudentData {
    student_id: number;
    name: string;
    phone: string;
    address?: string;
    phone_is_whatsapp?: boolean;
    whatsapp?: string;
    relationship?: string;
    academic_year_id?: number;
}

export async function createParentForStudent(
    data: CreateParentForStudentData,
): Promise<{ parent: RegistrationParent & { temporary_password: string } }> {
    const yearId = data.academic_year_id || (await getCurrentAcademicYear())?.id;
    if (!yearId) throw new Error('No current academic year found and none provided.');

    const student = await prisma.student.findUnique({ where: { id: data.student_id } });
    if (!student) throw new Error(`Student with ID ${data.student_id} not found.`);

    const name = data.name?.trim();
    const phone = data.phone?.trim();
    if (!name || !phone) throw new Error('Parent name and phone are required.');

    // Existing parent-count guard (max 2) to match the create-student flow.
    const existingLinks = await prisma.parentStudent.count({ where: { student_id: student.id } });
    if (existingLinks >= 2) {
        throw new Error('This student already has the maximum of 2 linked contacts.');
    }

    const whatsappNumber = data.phone_is_whatsapp
        ? phone
        : (data.whatsapp?.trim() || null);

    const parentMatricule = await generateStaffMatricule([Role.PARENT]);
    const generatedEmail = `parent.${phone.replace(/[^\d+]/g, '')}.${student.id}.${Date.now()}@school.local`;
    const hashedPassword = await bcrypt.hash('password123', 10);
    const relationshipEnum = normalizeRelationship(data.relationship);

    const result = await prisma.$transaction(async (tx) => {
        const parentUser = await tx.user.create({
            data: {
                name,
                email: generatedEmail,
                phone,
                whatsapp_number: whatsappNumber,
                address: data.address?.trim() || '',
                password: hashedPassword,
                must_change_password: true,
                gender: Gender.Male,
                date_of_birth: new Date('1980-01-01'),
                matricule: parentMatricule,
            },
        });

        await tx.userRole.create({
            data: { user_id: parentUser.id, role: Role.PARENT, academic_year_id: yearId },
        });

        await tx.parentStudent.create({
            data: {
                parent_id: parentUser.id,
                student_id: student.id,
                ...(relationshipEnum ? { relationship: relationshipEnum as Relationship } : {}),
            },
        });

        return parentUser;
    });

    return {
        parent: {
            id: result.id,
            matricule: result.matricule || '',
            name: result.name,
            phone: result.phone,
            whatsapp_number: result.whatsapp_number,
            relationship: relationshipEnum ?? null,
            temporary_password: 'password123',
        },
    };
}

/**
 * Reset a parent's password back to the default `password123` and force
 * them to change it on next login. Used by front-desk staff when a parent
 * forgets the password they set after first sign-in.
 */
export async function resetParentPassword(
    parentId: number,
    actorId: number,
): Promise<{ parent_id: number; matricule: string; name: string; temporary_password: 'password123' }> {
    const user = await prisma.user.findUnique({
        where: { id: parentId },
        include: {
            user_roles: {
                where: { role: Role.PARENT },
            },
        },
    });

    if (!user) {
        const err: any = new Error(`Parent with ID ${parentId} not found`);
        err.statusCode = 404;
        throw err;
    }

    if (!user.user_roles || user.user_roles.length === 0) {
        const err: any = new Error('User is not a parent');
        err.statusCode = 400;
        throw err;
    }

    const hashedPassword = await bcrypt.hash('password123', 10);

    await prisma.user.update({
        where: { id: user.id },
        data: {
            password: hashedPassword,
            must_change_password: true,
        },
    });

    console.log(
        `[PARENT_PASSWORD_RESET] parent_id=${user.id} actor_id=${actorId} matricule=${user.matricule ?? ''}`,
    );

    return {
        parent_id: user.id,
        matricule: user.matricule ?? '',
        name: user.name,
        temporary_password: 'password123',
    };
}

/**
 * Link an existing student to an existing parent
 */
export async function linkExistingParent(data: LinkExistingParentData): Promise<any> {
    try {
        // Check if parent exists
        const parent = await prisma.user.findUnique({
            where: { id: data.parent_id },
            include: {
                user_roles: {
                    where: { role: Role.PARENT }
                }
            }
        });

        if (!parent) {
            throw new Error('Parent not found');
        }

        // Check if student exists
        const student = await prisma.student.findUnique({
            where: { id: data.student_id }
        });

        if (!student) {
            throw new Error('Student not found');
        }

        // Check if link already exists
        const existingLink = await prisma.parentStudent.findFirst({
            where: {
                parent_id: data.parent_id,
                student_id: data.student_id
            }
        });

        if (existingLink) {
            throw new Error('Parent is already linked to this student');
        }

        // Create the link
        const relationshipEnum = normalizeRelationship(data.relationship);
        const link = await prisma.parentStudent.create({
            data: {
                parent_id: data.parent_id,
                student_id: data.student_id,
                ...(relationshipEnum ? { relationship: relationshipEnum as Relationship } : {})
            }
        });

        return {
            success: true,
            message: 'Parent linked to student successfully',
            data: link
        };
    } catch (error) {
        console.error('Error linking parent to student:', error);
        throw error;
    }
}

/**
 * Get available parents for selection (search and browse)
 */
export async function getAvailableParents(searchTerm?: string, limit: number = 20): Promise<ParentSearchResult[]> {
    try {
        const whereClause: any = {
            user_roles: {
                some: {
                    role: Role.PARENT
                }
            }
        };

        if (searchTerm) {
            whereClause.OR = [
                { name: { contains: searchTerm, mode: 'insensitive' } },
                { email: { contains: searchTerm, mode: 'insensitive' } },
                { phone: { contains: searchTerm, mode: 'insensitive' } }
            ];
        }

        const parents = await prisma.user.findMany({
            where: whereClause,
            include: {
                parent_students: {
                    include: {
                        student: {
                            include: {
                                enrollments: {
                                    include: {
                                        class: true
                                    },
                                    take: 1,
                                    orderBy: {
                                        created_at: 'desc'
                                    }
                                }
                            }
                        }
                    }
                }
            },
            take: limit
        });

        return parents.map(parent => ({
            id: parent.id,
            name: parent.name,
            email: parent.email,
            phone: parent.phone,
            matricule: parent.matricule || '',
            children_count: parent.parent_students.length,
            children: parent.parent_students.map(link => ({
                id: link.student.id,
                name: link.student.name,
                matricule: link.student.matricule,
                class_name: link.student.enrollments?.[0]?.class?.name
            }))
        }));
    } catch (error) {
        console.error('Error fetching available parents:', error);
        throw error;
    }
}

/**
 * Get bursar dashboard statistics
 */
export async function getBursarDashboard(academicYearId?: number): Promise<any> {
    try {
        const yearId = academicYearId || (await getCurrentAcademicYear())?.id;
        if (!yearId) {
            throw new Error('No current academic year found and none provided.');
        }

        const [
            owingFees,
            recentPayments,
            newStudents,
            studentsWithParents,
            studentsWithoutParents
        ] = await Promise.all([
            // Outstanding-fee rows for this year (one row per enrollment): used to
            // compute number of students owing and total amount owed.
            prisma.schoolFees.findMany({
                where: { academic_year_id: yearId },
                select: {
                    enrollment_id: true,
                    amount_expected: true,
                    amount_paid: true
                }
            }),

            // Recent payments (kept for recentTransactions/recentRegistrations)
            prisma.schoolFees.findMany({
                where: {
                    academic_year_id: yearId,
                    amount_paid: { gt: 0 }
                },
                include: {
                    enrollment: {
                        include: {
                            student: {
                                include: {
                                    parents: {
                                        include: {
                                            parent: true
                                        }
                                    }
                                }
                            },
                            class: true // Include the class directly from enrollment
                        }
                    }
                },
                orderBy: { updated_at: 'desc' },
                take: 5
            }),

            // New students this month
            prisma.student.count({
                where: {
                    created_at: {
                        gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
                    }
                }
            }),

            // Students with parents
            prisma.student.count({
                where: {
                    parents: {
                        some: {}
                    }
                }
            }),

            // Students without parents
            prisma.student.count({
                where: {
                    parents: {
                        none: {}
                    }
                }
            })
        ]);

        // Aggregate outstanding balances per enrollment (one student = one enrollment per year).
        const owingByEnrollment = new Map<number, number>();
        for (const row of owingFees) {
            const balance = (row.amount_expected || 0) - (row.amount_paid || 0);
            if (balance > 0) {
                owingByEnrollment.set(
                    row.enrollment_id,
                    (owingByEnrollment.get(row.enrollment_id) || 0) + balance
                );
            }
        }
        const studentsOwingCount = owingByEnrollment.size;
        const totalAmountOwed = Array.from(owingByEnrollment.values())
            .reduce((sum, v) => sum + v, 0);

        return {
            studentsOwingCount,
            totalAmountOwed,
            recentTransactions: recentPayments.length,
            newStudentsThisMonth: newStudents,
            studentsWithParents,
            studentsWithoutParents,
            paymentMethods: [
                { method: 'EXPRESS_UNION', count: 0, totalAmount: 0 },
                { method: 'CCA', count: 0, totalAmount: 0 },
                { method: 'F3DC', count: 0, totalAmount: 0 },
                { method: 'AFRILAND_FIRST_BANK', count: 0, totalAmount: 0 }
            ],
            recentRegistrations: recentPayments.slice(0, 5).map(payment => ({
                studentName: payment.enrollment.student.name,
                parentName: payment.enrollment.student.parents[0]?.parent?.name || 'N/A', // Get the first parent's name
                registrationDate: payment.enrollment.created_at,
                className: payment.enrollment.class?.name || 'N/A'
            }))
        };
    } catch (error) {
        console.error('Error fetching bursar dashboard:', error);
        throw error;
    }
}

/**
 * Defaulters (owing-fees) report.
 *
 * Aggregates outstanding SchoolFees rows for the given academic year, grouping
 * by class and by amount range. A student is a "defaulter" when the sum of
 * (amount_expected - amount_paid) across their SchoolFees rows for the year
 * is strictly greater than 0 (and, when minimumAmount is set, ≥ minimumAmount).
 */
export interface DefaultersReportOptions {
    academicYearId?: number;
    minimumAmount?: number;
    classId?: number;
    subClassId?: number;
    includeDetails?: boolean;
}

export async function getDefaultersReport(options: DefaultersReportOptions = {}): Promise<any> {
    const yearId = options.academicYearId || (await getCurrentAcademicYear())?.id;
    if (!yearId) {
        throw new Error('No current academic year found and none provided.');
    }

    const enrollmentFilter: any = {};
    if (options.classId) enrollmentFilter.class_id = options.classId;
    if (options.subClassId) enrollmentFilter.sub_class_id = options.subClassId;

    const feeRows = await prisma.schoolFees.findMany({
        where: {
            academic_year_id: yearId,
            ...(Object.keys(enrollmentFilter).length > 0
                ? { enrollment: { is: enrollmentFilter } }
                : {})
        },
        select: {
            enrollment_id: true,
            amount_expected: true,
            amount_paid: true,
            due_date: true,
            enrollment: {
                select: {
                    id: true,
                    class_id: true,
                    sub_class_id: true,
                    class: { select: { id: true, name: true } },
                    sub_class: { select: { id: true, name: true } },
                    student: {
                        select: {
                            id: true,
                            name: true,
                            matricule: true,
                            parents: {
                                select: {
                                    parent: {
                                        select: { name: true, phone: true, whatsapp_number: true }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    });

    // Aggregate per enrollment (unique constraint guarantees one row per
    // enrollment/year, but iterate defensively in case that ever changes).
    interface DefaulterAgg {
        enrollmentId: number;
        classId: number | null;
        className: string;
        subClassId: number | null;
        subClassName: string;
        studentId: number;
        studentName: string;
        matricule: string;
        outstanding: number;
        oldestDueDate: Date | null;
        parentPhone?: string;
    }

    const perEnrollment = new Map<number, DefaulterAgg>();

    for (const row of feeRows) {
        const balance = (row.amount_expected || 0) - (row.amount_paid || 0);
        if (balance <= 0) continue;

        const existing = perEnrollment.get(row.enrollment_id);
        if (existing) {
            existing.outstanding += balance;
            if (row.due_date && (!existing.oldestDueDate || row.due_date < existing.oldestDueDate)) {
                existing.oldestDueDate = row.due_date;
            }
            continue;
        }

        const enrollment = row.enrollment;
        const student = enrollment?.student;
        const firstParent = student?.parents?.[0]?.parent;
        perEnrollment.set(row.enrollment_id, {
            enrollmentId: row.enrollment_id,
            classId: enrollment?.class?.id ?? enrollment?.class_id ?? null,
            className: enrollment?.class?.name || 'Unassigned',
            subClassId: enrollment?.sub_class?.id ?? enrollment?.sub_class_id ?? null,
            subClassName: enrollment?.sub_class?.name || 'Unassigned',
            studentId: student?.id ?? 0,
            studentName: student?.name || 'Unknown',
            matricule: student?.matricule || '',
            outstanding: balance,
            oldestDueDate: row.due_date ?? null,
            parentPhone: firstParent?.whatsapp_number || firstParent?.phone || undefined
        });
    }

    const minAmount = typeof options.minimumAmount === 'number' && !Number.isNaN(options.minimumAmount)
        ? options.minimumAmount
        : 0;

    const defaulters = Array.from(perEnrollment.values()).filter(d => d.outstanding >= minAmount && d.outstanding > 0);

    // Group by class
    const byClassMap = new Map<string, {
        classId: number | null;
        className: string;
        defaultersCount: number;
        outstandingAmount: number;
    }>();
    for (const d of defaulters) {
        const key = String(d.classId ?? `name:${d.className}`);
        const bucket = byClassMap.get(key) || {
            classId: d.classId,
            className: d.className,
            defaultersCount: 0,
            outstandingAmount: 0
        };
        bucket.defaultersCount += 1;
        bucket.outstandingAmount += d.outstanding;
        byClassMap.set(key, bucket);
    }
    const byClass = Array.from(byClassMap.values()).sort((a, b) => b.outstandingAmount - a.outstandingAmount);

    // Group by amount range
    const ranges: Array<{ range: string; min: number; max: number | null }> = [
        { range: '0-10000', min: 0, max: 10000 },
        { range: '10001-50000', min: 10001, max: 50000 },
        { range: '50001-100000', min: 50001, max: 100000 },
        { range: '100000+', min: 100001, max: null }
    ];
    const byAmountRange = ranges.map(r => {
        const inBucket = defaulters.filter(d =>
            d.outstanding >= r.min && (r.max === null || d.outstanding <= r.max)
        );
        return {
            range: r.range,
            count: inBucket.length,
            totalAmount: inBucket.reduce((s, d) => s + d.outstanding, 0)
        };
    });

    const now = Date.now();
    const DAY_MS = 1000 * 60 * 60 * 24;

    const students = defaulters
        .sort((a, b) => b.outstanding - a.outstanding)
        .map(d => {
            const base: any = {
                studentId: d.studentId,
                studentName: d.studentName,
                matricule: d.matricule,
                className: d.className,
                subClassName: d.subClassName,
                outstandingAmount: d.outstanding,
                dueDate: d.oldestDueDate ? d.oldestDueDate.toISOString() : null,
                daysOverdue: d.oldestDueDate
                    ? Math.max(0, Math.floor((now - d.oldestDueDate.getTime()) / DAY_MS))
                    : 0
            };
            if (options.includeDetails && d.parentPhone) {
                base.contactParentPhone = d.parentPhone;
            }
            return base;
        });

    const totalOutstanding = defaulters.reduce((s, d) => s + d.outstanding, 0);

    return {
        totalDefaulters: defaulters.length,
        totalOutstanding,
        byClass,
        byAmountRange,
        students
    };
}
