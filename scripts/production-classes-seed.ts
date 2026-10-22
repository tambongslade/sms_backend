import { PrismaClient, Gender, Role, DayOfWeek, SubjectCategory } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
    console.log('🏫 Starting comprehensive production seeding...');
    
    // Clear existing data in correct order
    await clearDatabase();

    // 1. Create Academic Years
    const academicYears = await seedAcademicYears();
    const currentYear = academicYears.find(y => y.is_current)!;

    // 2. Create Users with various roles
    const users = await seedUsers();

    // 3. Create UserRoles
    await seedUserRoles(users, academicYears);

    // 4. Create Classes and SubClasses (Real production structure)
    const { classes, subclasses } = await seedProductionClassesAndSubclasses();

    // 5. Create Subjects
    const subjects = await seedSubjects(users);

    // 6. Create Periods
    const periods = await seedPeriods();

    // 7. Create Terms and Exam Sequences
    const { terms, examSequences } = await seedTermsAndExamSequences(currentYear.id);

    // 8. Create SubClass-Subject assignments
    await seedSubclassSubjectAssignments(subclasses, subjects);

    console.log('✅ Comprehensive production seeding completed successfully!');
    console.log('\n📋 Production Data Summary:');
    console.log(`- Academic Years: ${academicYears.length}`);
    console.log(`- Users: ${users.length}`);
    console.log(`- Classes: ${classes.length}`);
    console.log(`- SubClasses: ${subclasses.length}`);
    console.log(`- Subjects: ${subjects.length}`);
    console.log(`- Periods: ${periods.length}`);
    console.log(`- Terms: ${terms.length}`);
    console.log(`- Exam Sequences: ${examSequences.length}`);

    // Display the class structure
    console.log('\n🏫 Real Class Structure:');
    console.log('FORM 1: N, NN, M, MS, S, MW (6 subclasses)');
    console.log('FORM 2: N, MN, M, MS, S (5 subclasses)');
    console.log('FORM 3: N, MN, M, S (4 subclasses)');
    console.log('FORM 4: N, MN, M, S (4 subclasses)');
    console.log('FORM 5: N, MN, MS, S (4 subclasses)');
    console.log('LOWER SIXTH ARTS: A1, A2 (2 subclasses)');
    console.log('LOWER SIXTH SCIENCE: S1, S2 (2 subclasses)');
    console.log('UPPER SIXTH ARTS: A1, A2 (2 subclasses)');
    console.log('UPPER SIXTH SCIENCE: S1, S2 (2 subclasses)');
}

async function clearDatabase() {
    console.log('🧹 Clearing existing data...');

    // Handle optional tables that might not exist
    try {
        await prisma.auditLog.deleteMany();
        await prisma.formSubmission.deleteMany();
        await prisma.formTemplate.deleteMany();
        await prisma.quizResponse.deleteMany();
        await prisma.quizSubmission.deleteMany();
        await prisma.quizQuestion.deleteMany();
        await prisma.quizTemplate.deleteMany();
        console.log('✅ Optional tables cleared');
    } catch (error) {
        console.log('⚠️ Some optional tables not found - skipping');
    }

    await prisma.message.deleteMany();
    await prisma.interviewMark.deleteMany();
    await prisma.generatedReport.deleteMany();
    await prisma.studentSequenceAverage.deleteMany();
    await prisma.examPaperQuestion.deleteMany();
    await prisma.examPaper.deleteMany();
    await prisma.question.deleteMany();
    await prisma.mobileNotification.deleteMany();
    await prisma.announcement.deleteMany();
    await prisma.paymentTransaction.deleteMany();
    await prisma.teacherAbsence.deleteMany();
    await prisma.studentAbsence.deleteMany();
    await prisma.disciplineIssue.deleteMany();
    await prisma.mark.deleteMany();
    await prisma.teacherPeriod.deleteMany();
    await prisma.period.deleteMany();
    await prisma.subjectTeacher.deleteMany();
    await prisma.subClassSubject.deleteMany();
    await prisma.schoolFees.deleteMany();
    await prisma.enrollment.deleteMany();
    await prisma.parentStudent.deleteMany();
    await prisma.student.deleteMany();
    await prisma.subject.deleteMany();
    await prisma.subClass.deleteMany();
    await prisma.class.deleteMany();
    await prisma.examSequence.deleteMany();
    await prisma.term.deleteMany();
    await prisma.roleAssignment.deleteMany();
    await prisma.userRole.deleteMany();
    await prisma.user.deleteMany();
    await prisma.academicYear.deleteMany();

    console.log('✅ Database cleared successfully');
}

async function seedAcademicYears() {
    console.log('📅 Seeding Academic Years...');

    const academicYears = await Promise.all([
        prisma.academicYear.create({
            data: {
                name: '2025-2026',
                start_date: new Date('2025-09-01'),
                end_date: new Date('2026-06-30'),
                is_current: true,
                report_deadline: new Date('2026-07-15'),
            }
        })
    ]);

    console.log(`✅ Created ${academicYears.length} academic years`);
    return academicYears;
}

async function seedUsers() {
    console.log('👥 Seeding Production Users...');

    const hashedPassword = await bcrypt.hash('password123', 10);

    const users = await Promise.all([
        // Super Manager
        prisma.user.create({
            data: {
                name: 'System Administrator',
                email: 'admin@school.com',
                password: hashedPassword,
                gender: Gender.Male,
                date_of_birth: new Date('1980-01-15'),
                phone: '+237670000001',
                address: 'School Campus',
                matricule: 'SS24CEO0001',
                status: 'ACTIVE',
            }
        }),

        // Principal
        prisma.user.create({
            data: {
                name: 'School Principal',
                email: 'principal@school.com',
                password: hashedPassword,
                gender: Gender.Female,
                date_of_birth: new Date('1975-03-20'),
                phone: '+237670000002',
                address: 'School Campus',
                matricule: 'SS24SA0001',
                status: 'ACTIVE',
            }
        }),

        // Vice Principal
        prisma.user.create({
            data: {
                name: 'Vice Principal',
                email: 'vp@school.com',
                password: hashedPassword,
                gender: Gender.Male,
                date_of_birth: new Date('1978-07-10'),
                phone: '+237670000003',
                address: 'School Campus',
                matricule: 'SS24SA0002',
                status: 'ACTIVE',
            }
        }),

        // Bursar
        prisma.user.create({
            data: {
                name: 'School Bursar',
                email: 'bursar@school.com',
                password: hashedPassword,
                gender: Gender.Female,
                date_of_birth: new Date('1982-11-05'),
                phone: '+237670000004',
                address: 'School Campus',
                matricule: 'SS24SA0003',
                status: 'ACTIVE',
            }
        }),

        // Discipline Master
        prisma.user.create({
            data: {
                name: 'Discipline Master',
                email: 'discipline@school.com',
                password: hashedPassword,
                gender: Gender.Male,
                date_of_birth: new Date('1979-04-18'),
                phone: '+237670000005',
                address: 'School Campus',
                matricule: 'SS24SO0001',
                status: 'ACTIVE',
            }
        }),

        // Sample Teachers
        prisma.user.create({
            data: {
                name: 'Mathematics Teacher',
                email: 'math.teacher@school.com',
                password: hashedPassword,
                gender: Gender.Female,
                date_of_birth: new Date('1985-06-12'),
                phone: '+237670000006',
                address: 'School Campus',
                matricule: 'SS24ST0001',
                status: 'ACTIVE',
                total_hours_per_week: 20,
            }
        }),

        prisma.user.create({
            data: {
                name: 'Physics Teacher',
                email: 'physics.teacher@school.com',
                password: hashedPassword,
                gender: Gender.Male,
                date_of_birth: new Date('1983-09-25'),
                phone: '+237670000007',
                address: 'School Campus',
                matricule: 'SS24ST0002',
                status: 'ACTIVE',
                total_hours_per_week: 18,
            }
        }),

        prisma.user.create({
            data: {
                name: 'English Teacher',
                email: 'english.teacher@school.com',
                password: hashedPassword,
                gender: Gender.Female,
                date_of_birth: new Date('1987-02-14'),
                phone: '+237670000008',
                address: 'School Campus',
                matricule: 'SS24ST0003',
                status: 'ACTIVE',
                total_hours_per_week: 16,
            }
        }),

        prisma.user.create({
            data: {
                name: 'Chemistry Teacher',
                email: 'chemistry.teacher@school.com',
                password: hashedPassword,
                gender: Gender.Male,
                date_of_birth: new Date('1984-12-08'),
                phone: '+237670000009',
                address: 'School Campus',
                matricule: 'SS24ST0004',
                status: 'ACTIVE',
                total_hours_per_week: 15,
            }
        }),

        // HOD - Head of Department Science
        prisma.user.create({
            data: {
                name: 'HOD Science Department',
                email: 'hod.science@school.com',
                password: hashedPassword,
                gender: Gender.Male,
                date_of_birth: new Date('1976-10-22'),
                phone: '+237670000010',
                address: 'School Campus',
                matricule: 'SS24ST0005',
                status: 'ACTIVE',
                total_hours_per_week: 12,
            }
        }),

        // Sample Parent
        prisma.user.create({
            data: {
                name: 'Sample Parent',
                email: 'parent@example.com',
                password: hashedPassword,
                gender: Gender.Female,
                date_of_birth: new Date('1985-08-20'),
                phone: '+237670000011',
                whatsapp_number: '+237670000011',
                address: 'Yaounde, Cameroon',
                matricule: 'SS24SO0002',
                status: 'ACTIVE',
            }
        })
    ]);

    console.log(`✅ Created ${users.length} production users`);
    return users;
}

async function seedUserRoles(users: any[], academicYears: any[]) {
    console.log('🎭 Seeding User Roles...');

    const currentYearId = academicYears.find(y => y.is_current)?.id;

    const userRoles = [
        // Super Manager - Global role
        { user_id: users[0].id, role: Role.SUPER_MANAGER, academic_year_id: null },

        // Principal - Current year only
        { user_id: users[1].id, role: Role.PRINCIPAL, academic_year_id: currentYearId },

        // Vice Principal - Current year only
        { user_id: users[2].id, role: Role.VICE_PRINCIPAL, academic_year_id: currentYearId },

        // Bursar - Current year only
        { user_id: users[3].id, role: Role.BURSAR, academic_year_id: currentYearId },

        // Discipline Master - Current year
        { user_id: users[4].id, role: Role.DISCIPLINE_MASTER, academic_year_id: currentYearId },

        // Teachers - Current year
        { user_id: users[5].id, role: Role.TEACHER, academic_year_id: currentYearId },
        { user_id: users[6].id, role: Role.TEACHER, academic_year_id: currentYearId },
        { user_id: users[7].id, role: Role.TEACHER, academic_year_id: currentYearId },
        { user_id: users[8].id, role: Role.TEACHER, academic_year_id: currentYearId },

        // HOD - Both HOD and TEACHER roles
        { user_id: users[9].id, role: Role.HOD, academic_year_id: currentYearId },
        { user_id: users[9].id, role: Role.TEACHER, academic_year_id: currentYearId },

        // Parent - Current year
        { user_id: users[10].id, role: Role.PARENT, academic_year_id: currentYearId },
    ];

    // Filter out any assignments where academic year ID is undefined
    const validUserRoles = userRoles.filter(role =>
        role.academic_year_id === null || role.academic_year_id !== undefined
    );

    await prisma.userRole.createMany({
        data: validUserRoles,
    });

    console.log(`✅ Created ${validUserRoles.length} user roles`);
}

async function seedProductionClassesAndSubclasses() {
    console.log('🏫 Seeding Production Classes and SubClasses...');
    
    // Create the real classes with appropriate fees
    const classes = await Promise.all([
        // Form 1
        prisma.class.create({
            data: {
                name: 'FORM 1',
                max_students: 150, // 6 subclasses × 25 students
                base_fee: 175000,
                miscellaneous_fee: 0,
                new_student_fee: 175000,
                old_student_fee: 175000,
                first_term_fee: 58333,
                second_term_fee: 58333,
                third_term_fee: 58334,
            }
        }),
        
        // Form 2
        prisma.class.create({
            data: {
                name: 'FORM 2',
                max_students: 125, // 5 subclasses × 25 students
                base_fee: 175000,
                miscellaneous_fee: 0,
                new_student_fee: 175000,
                old_student_fee: 175000,
                first_term_fee: 58333,
                second_term_fee: 58333,
                third_term_fee: 58334,
            }
        }),
        
        // Form 3
        prisma.class.create({
            data: {
                name: 'FORM 3',
                max_students: 100, // 4 subclasses × 25 students
                base_fee: 175000,
                miscellaneous_fee: 0,
                new_student_fee: 175000,
                old_student_fee: 175000,
                first_term_fee: 58333,
                second_term_fee: 58333,
                third_term_fee: 58334,
            }
        }),
        
        // Form 4
        prisma.class.create({
            data: {
                name: 'FORM 4',
                max_students: 100, // 4 subclasses × 25 students
                base_fee: 175000,
                miscellaneous_fee: 0,
                new_student_fee: 175000,
                old_student_fee: 175000,
                first_term_fee: 58333,
                second_term_fee: 58333,
                third_term_fee: 58334,
            }
        }),
        
        // Form 5
        prisma.class.create({
            data: {
                name: 'FORM 5',
                max_students: 100, // 4 subclasses × 25 students
                base_fee: 175000,
                miscellaneous_fee: 0,
                new_student_fee: 175000,
                old_student_fee: 175000,
                first_term_fee: 58333,
                second_term_fee: 58333,
                third_term_fee: 58334,
            }
        }),
        
        // Lower Sixth Arts
        prisma.class.create({
            data: {
                name: 'LOWER SIXTH ARTS',
                max_students: 50, // 2 subclasses × 25 students
                base_fee: 175000,
                miscellaneous_fee: 0,
                new_student_fee: 175000,
                old_student_fee: 175000,
                first_term_fee: 58333,
                second_term_fee: 58333,
                third_term_fee: 58334,
            }
        }),
        
        // Lower Sixth Science
        prisma.class.create({
            data: {
                name: 'LOWER SIXTH SCIENCE',
                max_students: 50, // 2 subclasses × 25 students
                base_fee: 175000,
                miscellaneous_fee: 0,
                new_student_fee: 175000,
                old_student_fee: 175000,
                first_term_fee: 58333,
                second_term_fee: 58333,
                third_term_fee: 58334,
            }
        }),
        
        // Upper Sixth Arts
        prisma.class.create({
            data: {
                name: 'UPPER SIXTH ARTS',
                max_students: 50, // 2 subclasses × 25 students
                base_fee: 175000,
                miscellaneous_fee: 0,
                new_student_fee: 175000,
                old_student_fee: 175000,
                first_term_fee: 58333,
                second_term_fee: 58333,
                third_term_fee: 58334,
            }
        }),
        
        // Upper Sixth Science
        prisma.class.create({
            data: {
                name: 'UPPER SIXTH SCIENCE',
                max_students: 50, // 2 subclasses × 25 students
                base_fee: 175000,
                miscellaneous_fee: 0,
                new_student_fee: 175000,
                old_student_fee: 175000,
                first_term_fee: 58333,
                second_term_fee: 58333,
                third_term_fee: 58334,
            }
        })
    ]);
    
    // Create subclasses based on the image structure
    const subclasses = await Promise.all([
        // FORM 1 SubClasses: N, NN, M, MS, S, MW
        prisma.subClass.create({
            data: {
                name: 'FORM 1 N',
                class_id: classes[0].id, // FORM 1
                current_students: 0,
            }
        }),
        prisma.subClass.create({
            data: {
                name: 'FORM 1 NN',
                class_id: classes[0].id, // FORM 1
                current_students: 0,
            }
        }),
        prisma.subClass.create({
            data: {
                name: 'FORM 1 M',
                class_id: classes[0].id, // FORM 1
                current_students: 0,
            }
        }),
        prisma.subClass.create({
            data: {
                name: 'FORM 1 MS',
                class_id: classes[0].id, // FORM 1
                current_students: 0,
            }
        }),
        prisma.subClass.create({
            data: {
                name: 'FORM 1 S',
                class_id: classes[0].id, // FORM 1
                current_students: 0,
            }
        }),
        prisma.subClass.create({
            data: {
                name: 'FORM 1 MW',
                class_id: classes[0].id, // FORM 1
                current_students: 0,
            }
        }),
        
        // FORM 2 SubClasses: N, MN, M, MS, S
        prisma.subClass.create({
            data: {
                name: 'FORM 2 N',
                class_id: classes[1].id, // FORM 2
                current_students: 0,
            }
        }),
        prisma.subClass.create({
            data: {
                name: 'FORM 2 MN',
                class_id: classes[1].id, // FORM 2
                current_students: 0,
            }
        }),
        prisma.subClass.create({
            data: {
                name: 'FORM 2 M',
                class_id: classes[1].id, // FORM 2
                current_students: 0,
            }
        }),
        prisma.subClass.create({
            data: {
                name: 'FORM 2 MS',
                class_id: classes[1].id, // FORM 2
                current_students: 0,
            }
        }),
        prisma.subClass.create({
            data: {
                name: 'FORM 2 S',
                class_id: classes[1].id, // FORM 2
                current_students: 0,
            }
        }),
        
        // FORM 3 SubClasses: N, MN, M, S
        prisma.subClass.create({
            data: {
                name: 'FORM 3 N',
                class_id: classes[2].id, // FORM 3
                current_students: 0,
            }
        }),
        prisma.subClass.create({
            data: {
                name: 'FORM 3 MN',
                class_id: classes[2].id, // FORM 3
                current_students: 0,
            }
        }),
        prisma.subClass.create({
            data: {
                name: 'FORM 3 M',
                class_id: classes[2].id, // FORM 3
                current_students: 0,
            }
        }),
        prisma.subClass.create({
            data: {
                name: 'FORM 3 S',
                class_id: classes[2].id, // FORM 3
                current_students: 0,
            }
        }),
        
        // FORM 4 SubClasses: N, MN, M, S
        prisma.subClass.create({
            data: {
                name: 'FORM 4 N',
                class_id: classes[3].id, // FORM 4
                current_students: 0,
            }
        }),
        prisma.subClass.create({
            data: {
                name: 'FORM 4 MN',
                class_id: classes[3].id, // FORM 4
                current_students: 0,
            }
        }),
        prisma.subClass.create({
            data: {
                name: 'FORM 4 M',
                class_id: classes[3].id, // FORM 4
                current_students: 0,
            }
        }),
        prisma.subClass.create({
            data: {
                name: 'FORM 4 S',
                class_id: classes[3].id, // FORM 4
                current_students: 0,
            }
        }),
        
        // FORM 5 SubClasses: N, MN, MS, S
        prisma.subClass.create({
            data: {
                name: 'FORM 5 N',
                class_id: classes[4].id, // FORM 5
                current_students: 0,
            }
        }),
        prisma.subClass.create({
            data: {
                name: 'FORM 5 MN',
                class_id: classes[4].id, // FORM 5
                current_students: 0,
            }
        }),
        prisma.subClass.create({
            data: {
                name: 'FORM 5 MS',
                class_id: classes[4].id, // FORM 5
                current_students: 0,
            }
        }),
        prisma.subClass.create({
            data: {
                name: 'FORM 5 S',
                class_id: classes[4].id, // FORM 5
                current_students: 0,
            }
        }),
        
        // LOWER SIXTH ARTS SubClasses: A1, A2
        prisma.subClass.create({
            data: {
                name: 'LOWER SIXTH A1',
                class_id: classes[5].id, // LOWER SIXTH ARTS
                current_students: 0,
            }
        }),
        prisma.subClass.create({
            data: {
                name: 'LOWER SIXTH A2',
                class_id: classes[5].id, // LOWER SIXTH ARTS
                current_students: 0,
            }
        }),
        
        // LOWER SIXTH SCIENCE SubClasses: S1, S2
        prisma.subClass.create({
            data: {
                name: 'LOWER SIXTH S1',
                class_id: classes[6].id, // LOWER SIXTH SCIENCE
                current_students: 0,
            }
        }),
        prisma.subClass.create({
            data: {
                name: 'LOWER SIXTH S2',
                class_id: classes[6].id, // LOWER SIXTH SCIENCE
                current_students: 0,
            }
        }),
        
        // UPPER SIXTH ARTS SubClasses: A1, A2
        prisma.subClass.create({
            data: {
                name: 'UPPER SIXTH A1',
                class_id: classes[7].id, // UPPER SIXTH ARTS
                current_students: 0,
            }
        }),
        prisma.subClass.create({
            data: {
                name: 'UPPER SIXTH A2',
                class_id: classes[7].id, // UPPER SIXTH ARTS
                current_students: 0,
            }
        }),
        
        // UPPER SIXTH SCIENCE SubClasses: S1, S2
        prisma.subClass.create({
            data: {
                name: 'UPPER SIXTH S1',
                class_id: classes[8].id, // UPPER SIXTH SCIENCE
                current_students: 0,
            }
        }),
        prisma.subClass.create({
            data: {
                name: 'UPPER SIXTH S2',
                class_id: classes[8].id, // UPPER SIXTH SCIENCE
                current_students: 0,
            }
        })
    ]);
    
    console.log(`✅ Created ${classes.length} classes and ${subclasses.length} subclasses`);
    return { classes, subclasses };
}

async function seedSubjects(users: any[]) {
    console.log('📚 Seeding Subjects...');

    const hodUser = users.find(u => u.matricule === 'SS24ST0005'); // HOD Science

    const subjects = await Promise.all([
        // Core Science & Technology
        prisma.subject.create({
            data: {
                name: 'Mathematics',
                category: 'SCIENCE_AND_TECHNOLOGY',
                hod_id: hodUser?.id,
            }
        }),
        prisma.subject.create({
            data: {
                name: 'Physics',
                category: 'SCIENCE_AND_TECHNOLOGY',
                hod_id: hodUser?.id,
            }
        }),
        prisma.subject.create({
            data: {
                name: 'Chemistry',
                category: 'SCIENCE_AND_TECHNOLOGY',
                hod_id: hodUser?.id,
            }
        }),
        prisma.subject.create({
            data: {
                name: 'Biology',
                category: 'SCIENCE_AND_TECHNOLOGY',
                hod_id: hodUser?.id,
            }
        }),
        prisma.subject.create({
            data: {
                name: 'Computer Science',
                category: 'SCIENCE_AND_TECHNOLOGY',
                hod_id: hodUser?.id,
            }
        }),
        prisma.subject.create({
            data: {
                name: 'Additional Mathematics',
                category: 'SCIENCE_AND_TECHNOLOGY',
                hod_id: hodUser?.id,
            }
        }),

        // Languages & Literature
        prisma.subject.create({
            data: {
                name: 'English Language',
                category: 'LANGUAGES_AND_LITERATURE',
            }
        }),
        prisma.subject.create({
            data: {
                name: 'French',
                category: 'LANGUAGES_AND_LITERATURE',
            }
        }),
        prisma.subject.create({
            data: {
                name: 'Literature in English',
                category: 'LANGUAGES_AND_LITERATURE',
            }
        }),

        // Human & Social Sciences
        prisma.subject.create({
            data: {
                name: 'History',
                category: 'HUMAN_AND_SOCIAL_SCIENCE',
            }
        }),
        prisma.subject.create({
            data: {
                name: 'Geography',
                category: 'HUMAN_AND_SOCIAL_SCIENCE',
            }
        }),
        prisma.subject.create({
            data: {
                name: 'Economics',
                category: 'HUMAN_AND_SOCIAL_SCIENCE',
            }
        }),

        // Others
        prisma.subject.create({
            data: {
                name: 'Physical Education',
                category: 'OTHERS',
            }
        }),
        prisma.subject.create({
            data: {
                name: 'Religious Studies',
                category: 'OTHERS',
            }
        }),
        prisma.subject.create({
            data: {
                name: 'Arts & Crafts',
                category: 'OTHERS',
            }
        }),
        prisma.subject.create({
            data: {
                name: 'Music',
                category: 'OTHERS',
            }
        })
    ]);

    console.log(`✅ Created ${subjects.length} subjects`);
    return subjects;
}

async function seedPeriods() {
    console.log('⏰ Seeding Periods...');

    const periods: any[] = [];
    const timeSlots = [
        { start: '07:30', end: '08:20', name: 'Period 1' },
        { start: '08:20', end: '09:10', name: 'Period 2' },
        { start: '09:10', end: '09:30', name: 'Break', isBreak: true },
        { start: '09:30', end: '10:20', name: 'Period 3' },
        { start: '10:20', end: '11:10', name: 'Period 4' },
        { start: '11:10', end: '12:00', name: 'Period 5' },
        { start: '12:00', end: '13:00', name: 'Lunch Break', isBreak: true },
        { start: '13:00', end: '13:50', name: 'Period 6' },
        { start: '13:50', end: '14:40', name: 'Period 7' },
        { start: '14:40', end: '15:30', name: 'Period 8' },
    ];

    const daysOfWeek = [DayOfWeek.MONDAY, DayOfWeek.TUESDAY, DayOfWeek.WEDNESDAY, DayOfWeek.THURSDAY, DayOfWeek.FRIDAY];

    for (const day of daysOfWeek) {
        for (const slot of timeSlots) {
            const period = await prisma.period.create({
                data: {
                    day_of_week: day,
                    start_time: slot.start,
                    end_time: slot.end,
                    name: `${day} ${slot.name}`,
                    is_break: slot.isBreak || false,
                }
            });
            periods.push(period);
        }
    }

    console.log(`✅ Created ${periods.length} periods`);
    return periods;
}

async function seedTermsAndExamSequences(academicYearId: number) {
    console.log('📅 Seeding Terms and Exam Sequences...');

    const terms = await Promise.all([
        prisma.term.create({
            data: {
                name: 'First Term',
                start_date: new Date('2025-09-01'),
                end_date: new Date('2025-12-15'),
                academic_year_id: academicYearId,
                fee_deadline: new Date('2025-10-15'),
            }
        }),
        prisma.term.create({
            data: {
                name: 'Second Term',
                start_date: new Date('2026-01-15'),
                end_date: new Date('2026-04-15'),
                academic_year_id: academicYearId,
                fee_deadline: new Date('2026-02-15'),
            }
        }),
        prisma.term.create({
            data: {
                name: 'Third Term',
                start_date: new Date('2026-04-20'),
                end_date: new Date('2026-06-30'),
                academic_year_id: academicYearId,
                fee_deadline: new Date('2026-05-15'),
            }
        })
    ]);

    const examSequences = await Promise.all([
        // First Term Sequences
        prisma.examSequence.create({
            data: {
                sequence_number: 1,
                academic_year_id: academicYearId,
                term_id: terms[0].id,
                status: 'OPEN',
            }
        }),
        prisma.examSequence.create({
            data: {
                sequence_number: 2,
                academic_year_id: academicYearId,
                term_id: terms[0].id,
                status: 'OPEN',
            }
        }),

        // Second Term Sequences
        prisma.examSequence.create({
            data: {
                sequence_number: 1,
                academic_year_id: academicYearId,
                term_id: terms[1].id,
                status: 'OPEN',
            }
        }),
        prisma.examSequence.create({
            data: {
                sequence_number: 2,
                academic_year_id: academicYearId,
                term_id: terms[1].id,
                status: 'OPEN',
            }
        }),

        // Third Term Sequences
        prisma.examSequence.create({
            data: {
                sequence_number: 1,
                academic_year_id: academicYearId,
                term_id: terms[2].id,
                status: 'OPEN',
            }
        }),
        prisma.examSequence.create({
            data: {
                sequence_number: 2,
                academic_year_id: academicYearId,
                term_id: terms[2].id,
                status: 'OPEN',
            }
        })
    ]);

    console.log(`✅ Created ${terms.length} terms and ${examSequences.length} exam sequences`);
    return { terms, examSequences };
}

async function seedSubclassSubjectAssignments(subclasses: any[], subjects: any[]) {
    console.log('📖 Seeding SubClass-Subject assignments...');

    const subclassSubjects: any[] = [];

    // Define core subjects for each level
    const coreSubjectsByLevel = {
        // Forms 1-5 core subjects
        forms: [
            { name: 'Mathematics', coefficient: 4 },
            { name: 'English Language', coefficient: 3 },
            { name: 'French', coefficient: 3 },
            { name: 'Physics', coefficient: 3 },
            { name: 'Chemistry', coefficient: 3 },
            { name: 'Biology', coefficient: 2 },
            { name: 'History', coefficient: 2 },
            { name: 'Geography', coefficient: 2 },
            { name: 'Physical Education', coefficient: 1 },
        ],
        // Sixth form Arts subjects
        sixthArts: [
            { name: 'English Language', coefficient: 4 },
            { name: 'Literature in English', coefficient: 4 },
            { name: 'French', coefficient: 3 },
            { name: 'History', coefficient: 3 },
            { name: 'Geography', coefficient: 3 },
            { name: 'Economics', coefficient: 3 },
        ],
        // Sixth form Science subjects
        sixthScience: [
            { name: 'Mathematics', coefficient: 4 },
            { name: 'Additional Mathematics', coefficient: 4 },
            { name: 'Physics', coefficient: 4 },
            { name: 'Chemistry', coefficient: 4 },
            { name: 'Biology', coefficient: 3 },
            { name: 'English Language', coefficient: 3 },
            { name: 'Computer Science', coefficient: 2 },
        ]
    };

    for (const subclass of subclasses) {
        let relevantSubjects: any[] = [];

        if (subclass.name.includes('UPPER SIXTH') || subclass.name.includes('LOWER SIXTH')) {
            if (subclass.name.includes('A1') || subclass.name.includes('A2')) {
                // Arts subclass
                relevantSubjects = coreSubjectsByLevel.sixthArts;
            } else {
                // Science subclass
                relevantSubjects = coreSubjectsByLevel.sixthScience;
            }
        } else {
            // Forms 1-5
            relevantSubjects = coreSubjectsByLevel.forms;
        }

        for (const subjectData of relevantSubjects) {
            const subject = subjects.find(s => s.name === subjectData.name);
            if (subject) {
                subclassSubjects.push({
                    sub_class_id: subclass.id,
                    subject_id: subject.id,
                    coefficient: subjectData.coefficient,
                });
            }
        }
    }

    await prisma.subClassSubject.createMany({
        data: subclassSubjects
    });

    console.log(`✅ Created ${subclassSubjects.length} subclass-subject assignments`);
}

// Execute the seeding
main()
    .catch((e) => {
        console.error('❌ Error during production seeding:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });