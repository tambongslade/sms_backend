/**
 * The retrieval corpus for the assistant.
 *
 * The database has 89 tables. Handing all of them to a 4B model on a 4 GB card
 * would blow the context and slow generation to a crawl, and most of a school's
 * questions touch a handful of tables. So each entry below describes one table
 * in the terms a question would use, and the retriever picks the few that match
 * before anything reaches the model.
 *
 * `keywords` is what the retriever scores against — it should read like the
 * words a bursar or principal would actually type, not like column names.
 * `columns` is what the model is shown, and is deliberately a subset: listing
 * every column invites the model to select things nobody asked for.
 */

export interface CatalogEntry {
    table: string;
    description: string;
    columns: string;
    keywords: string[];
    joins?: string;
}

export const SCHEMA_CATALOG: CatalogEntry[] = [
    {
        table: 'Student',
        description: 'One row per student ever registered. Not scoped to a year — a student stays here after leaving, so counts of "current" students must go through Enrollment. gender is an enum with exactly two values, spelled Male and Female (not upper case).',
        columns: 'id, name, matricule, date_of_birth, place_of_birth, gender, residence, former_school, status, first_enrollment_year_id, admission_academic_year_id, created_at',
        keywords: ['student', 'students', 'pupil', 'pupils', 'child', 'children', 'learner', 'matricule', 'gender', 'boy', 'girl', 'male', 'female', 'age', 'born', 'birth'],
        joins: 'Enrollment.student_id = Student.id',
    },
    {
        table: 'Enrollment',
        description: 'Links a student to a class and subclass for one academic year. This is the table that answers "how many students are in X" — one row per student per year.',
        columns: 'id, student_id, class_id, sub_class_id, academic_year_id, repeater, photo, created_at',
        keywords: ['enrolled', 'enrolment', 'enrollment', 'in class', 'in form', 'how many students', 'class size', 'repeater', 'repeating', 'roll', 'registered'],
        joins: 'Enrollment.class_id = Class.id, Enrollment.sub_class_id = SubClass.id, Enrollment.student_id = Student.id, Enrollment.academic_year_id = AcademicYear.id',
    },
    {
        table: 'Class',
        description: 'A year group such as FORM 1 or LOWER SIXTH ARTS. Names are upper case.',
        columns: 'id, name, level, base_fee, new_student_fee, old_student_fee, first_term_fee, second_term_fee, third_term_fee, academic_year_id',
        keywords: ['class', 'classes', 'form', 'form 1', 'form 2', 'form 3', 'form 4', 'form 5', 'sixth', 'lower sixth', 'upper sixth', 'arts', 'science', 'level', 'year group'],
        joins: 'SubClass.class_id = Class.id',
    },
    {
        table: 'SubClass',
        description: 'A stream within a class, e.g. FORM 1 N or FORM 1 MS. Each belongs to exactly one Class.',
        columns: 'id, name, class_id, class_master_id',
        keywords: ['subclass', 'sub class', 'stream', 'section', 'arm', 'class master'],
        joins: 'SubClass.class_id = Class.id',
    },
    {
        table: 'SchoolFees',
        description: 'The fee owed by one enrolment for one year: amount_expected against amount_paid. Outstanding balance is amount_expected - amount_paid; a student "owes" when that is greater than zero.',
        columns: 'id, amount_expected, amount_paid, academic_year_id, enrollment_id, due_date, created_at',
        keywords: ['fee', 'fees', 'owing', 'owe', 'owes', 'debt', 'debtor', 'balance', 'outstanding', 'unpaid', 'arrears', 'paid', 'expected', 'due', 'school fees'],
        joins: 'SchoolFees.enrollment_id = Enrollment.id',
    },
    {
        table: 'PaymentTransaction',
        description: 'An individual payment against a fee record. Sum these for revenue collected over a period. payment_method is an enum whose ONLY values are EXPRESS_UNION, CCA, F3DC, AFRILAND_FIRST_BANK — there is no cash or mobile-money value, and comparing against any other string is a type error, not an empty result.',
        columns: 'id, enrollment_id, academic_year_id, amount, payment_date, receipt_number, payment_method, fee_id, recorded_by_id',
        keywords: ['payment', 'payments', 'paid', 'collected', 'revenue', 'income', 'receipt', 'transaction', 'cash', 'momo', 'mobile money', 'bank', 'express union', 'afriland', 'today', 'this month'],
        joins: 'PaymentTransaction.enrollment_id = Enrollment.id',
    },
    {
        table: 'SubClassSubject',
        description: 'Links a subject to a subclass, with the coefficient used to weight its marks. Marks join to this rather than directly to Subject, so any question about performance by subject passes through here. It also has a nullable "userId" column, but that column is not populated in this database — do NOT use it to find who teaches a subject, it will return nothing. Use TeacherPeriod for that.',
        columns: 'id, sub_class_id, subject_id, coefficient, userId',
        keywords: ['subject', 'coefficient', 'weighting', 'taught', 'per subject', 'by subject', 'subject average'],
        joins: 'SubClassSubject.sub_class_id = SubClass.id, SubClassSubject.subject_id = Subject.id',
    },
    {
        // Without this table the catalog described teachers and subjects but no
        // way to get from one to the other, so "how many English teachers" had
        // no answerable form. The model does not decline in that situation — it
        // invents a join and states the result plainly, which is how a wrong
        // teacher count reached a principal.
        table: 'TeacherPeriod',
        description: 'Which teacher teaches which subject, to which subclass, in which timetable period. This is the ONLY populated link between a teacher and a subject: to find the teachers of a subject, join TeacherPeriod to Subject on subject_id and to User on teacher_id. A teacher appears once per period taught, so always COUNT(DISTINCT teacher_id) and SELECT DISTINCT when listing people, or the same teacher is counted once per lesson on the timetable. teacher_id is nullable — a slot may carry a subject with no teacher assigned yet, and those rows must not be counted as teachers. Scope by academic_year_id for a specific year.',
        columns: 'id, teacher_id, subject_id, sub_class_id, period_id, academic_year_id, assigned_by_id',
        keywords: ['teacher', 'teachers', 'teaches', 'teaching', 'who teaches', 'subject teacher', 'timetable', 'period', 'assigned', 'workload', 'lessons'],
        joins: 'TeacherPeriod.teacher_id = User.id, TeacherPeriod.subject_id = Subject.id, TeacherPeriod.sub_class_id = SubClass.id, TeacherPeriod.academic_year_id = AcademicYear.id',
    },
    {
        table: 'ParentStudent',
        description: 'Links a parent or guardian to a student. The parent is a User holding the PARENT role; the student is a Student. Use this for any question about a student\'s parents, a parent\'s children, or contact details for a child\'s family — the parent\'s phone and email live on User, not here. A student may have several parents and a parent several children, so COUNT(DISTINCT ...) when counting either side.',
        columns: 'id, parent_id, student_id, relationship',
        keywords: ['parent', 'parents', 'guardian', 'guardians', 'father', 'mother', 'family', 'children', 'child', 'next of kin', 'contact'],
        joins: 'ParentStudent.parent_id = User.id, ParentStudent.student_id = Student.id',
    },
    {
        // Kept deliberately alongside TeacherPeriod, with the difference spelled
        // out. Two tables that both look like "who teaches what" is precisely
        // the shape that produces a confident wrong answer, and this one is the
        // less complete of the pair.
        table: 'SubjectTeacher',
        description: 'A declared subject-to-teacher assignment, independent of the timetable. IMPORTANT: this is NOT the same as TeacherPeriod and the two disagree. SubjectTeacher covers only 17 of the 34 subjects, so counting teachers from it under-reports for the rest; TeacherPeriod covers 25 and reflects who actually teaches on this year\'s timetable. Prefer TeacherPeriod for "who teaches X" or "how many X teachers". Use this table only when the question is explicitly about declared or assigned subject specialisms rather than timetabled lessons, and say which basis was used.',
        columns: 'id, subject_id, teacher_id',
        keywords: ['subject teacher', 'declared', 'specialism', 'assigned subject', 'qualified'],
        joins: 'SubjectTeacher.subject_id = Subject.id, SubjectTeacher.teacher_id = User.id',
    },
    {
        table: 'Period',
        description: 'One slot in the timetable grid: a day of the week, a start and end time, and whether it is a teaching period or a break. TeacherPeriod points at these. Filter on is_break = false when counting teaching time, or breaks are counted as lessons.',
        columns: 'id, name, day_of_week, start_time, end_time, is_break, type, sequence, period_set_id',
        keywords: ['period', 'periods', 'timetable', 'slot', 'lesson time', 'break', 'day of week', 'schedule'],
        joins: 'Period.period_set_id = PeriodSet.id, TeacherPeriod.period_id = Period.id',
    },
    {
        table: 'PeriodSet',
        description: 'A named timetable structure for an academic year, such as first cycle and second cycle, grouping the Periods that belong to it. Classes point at the set they follow.',
        columns: 'id, code, name, academic_year_id, description',
        keywords: ['period set', 'cycle', 'first cycle', 'second cycle', 'timetable structure'],
        joins: 'PeriodSet.academic_year_id = AcademicYear.id, Period.period_set_id = PeriodSet.id',
    },
    {
        // Same hazard as SubjectTeacher, with money attached. SchoolFees and
        // ControlSchoolFees have near-identical columns, and a question about
        // fees answered from the wrong one is wrong by a factor of four on the
        // current data.
        table: 'ControlSchoolFees',
        description: 'A SEPARATE control ledger of expected and paid fees per enrolment, with its own payments in ControlPaymentTransaction. It is NOT a view of SchoolFees and must never be mixed with it or added to it — the two are parallel records and hold different row counts. Ordinary questions about fees, what is owed, or what has been collected use SchoolFees and PaymentTransaction. Use this table only when the question says "control" explicitly, and state which ledger the answer came from.',
        columns: 'id, enrollment_id, academic_year_id, amount_expected, amount_paid, due_date, is_new_student',
        keywords: ['control fee', 'control fees', 'control ledger', 'control payment'],
        joins: 'ControlSchoolFees.enrollment_id = Enrollment.id, ControlSchoolFees.academic_year_id = AcademicYear.id',
    },
    {
        table: 'User',
        description: 'Every person with a login: teachers, bursars, principals, parents. Role is held in UserRole, not here. The password column is not readable.',
        columns: 'id, name, gender, date_of_birth, phone, whatsapp_number, address, email, matricule, status, total_hours_per_week, created_at',
        keywords: ['user', 'users', 'staff', 'teacher', 'teachers', 'personnel', 'employee', 'bursar', 'principal', 'parent', 'parents', 'account'],
        joins: 'UserRole.user_id = User.id',
    },
    {
        table: 'UserRole',
        description: 'Which roles a user holds, optionally scoped to an academic year. Role values include SUPER_MANAGER, PRINCIPAL, VICE_PRINCIPAL, TEACHER, BURSAR, PARENT, DISCIPLINE_MASTER, GUIDANCE_COUNSELOR, HOD, MANAGER.',
        columns: 'id, user_id, role, academic_year_id',
        keywords: ['role', 'roles', 'teacher', 'teachers', 'bursar', 'principal', 'parent', 'staff count', 'how many teachers', 'permission'],
        joins: 'UserRole.user_id = User.id',
    },
    {
        table: 'AcademicYear',
        description: 'A school year. is_current marks the active one — year-scoped questions should filter on it unless a specific year is named.',
        columns: 'id, name, start_date, end_date, is_current, report_deadline',
        keywords: ['academic year', 'year', 'current year', 'session', 'term dates'],
    },
    {
        table: 'Subject',
        description: 'A taught subject, with its category.',
        columns: 'id, name, category, hod_id',
        keywords: ['subject', 'subjects', 'course', 'discipline', 'hod', 'head of department'],
        joins: 'SubClassSubject.subject_id = Subject.id',
    },
    {
        table: 'Mark',
        description: 'A score for one enrolment, in one subject, for one exam sequence. The subject is reached through sub_class_subject_id -> "SubClassSubject" -> "Subject"; there is no subject_id on this table, and no academic_year_id either — for a year, join "Enrollment" and filter on its academic_year_id.',
        columns: 'id, enrollment_id, sub_class_subject_id, exam_sequence_id, score, teacher_id',
        keywords: ['mark', 'marks', 'score', 'scores', 'grade', 'grades', 'result', 'results', 'average', 'exam', 'performance', 'pass', 'fail'],
        joins: 'Mark.enrollment_id = Enrollment.id, Mark.exam_sequence_id = ExamSequence.id, Mark.sub_class_subject_id = SubClassSubject.id',
    },
    {
        table: 'StudentAbsence',
        description: 'A recorded student absence. There is NO student_id column — reach the student through enrollment_id. absence_type is an enum with exactly two values: MORNING_LATENESS and CLASS_ABSENCE.',
        columns: 'id, enrollment_id, assigned_by_id, absence_type, is_excused, excuse_reason, created_at',
        keywords: ['absent', 'absence', 'absences', 'attendance', 'missed', 'away', 'truant', 'lateness', 'late', 'excused'],
        joins: 'StudentAbsence.enrollment_id = Enrollment.id',
    },
    {
        table: 'DisciplineIssue',
        description: 'A disciplinary incident logged against an enrolment.',
        columns: 'id, enrollment_id, issue_type, description, notes, assigned_by_id, reviewed_by_id, created_at',
        keywords: ['discipline', 'disciplinary', 'issue', 'incident', 'misconduct', 'behaviour', 'behavior', 'punishment', 'offence'],
        joins: 'DisciplineIssue.enrollment_id = Enrollment.id',
    },
    {
        table: 'ExamSequence',
        description: 'One evaluation period (a sequence) inside a term.',
        columns: 'id, sequence_number, term_id, academic_year_id, status, start_date, end_date',
        keywords: ['sequence', 'exam', 'evaluation', 'assessment', 'test'],
        joins: 'ExamSequence.term_id = Term.id',
    },
    {
        table: 'Term',
        description: 'A term within an academic year.',
        columns: 'id, name, start_date, end_date, academic_year_id, fee_deadline',
        keywords: ['term', 'terms', 'first term', 'second term', 'third term', 'semester'],
    },
];

/** Tables the assistant is permitted to name. Anything else is rejected. */
export const ALLOWED_TABLES: ReadonlySet<string> = new Set(
    SCHEMA_CATALOG.map(e => e.table)
);

/**
 * Which unrecorded area a question is about, or null.
 *
 * Decided here, in code, before the model is ever called. An earlier attempt
 * put the same list in the prompt and asked the model to answer in prose when a
 * question matched. A 4B model handed a prose escape from a prompt built
 * entirely to force SQL took it constantly: "Can I know the timetable of Sunday
 * Vincent" — a question with tables, data, and an obvious query — came back as
 * "The school does not record it yet."
 *
 * The model's job is to write SELECT statements. Anything that is a judgement
 * about what the school does and does not keep belongs on this side of the
 * call, where it is a list of words rather than an inference.
 */
const UNRECORDED_TOPICS: Array<{ topic: string; pattern: RegExp }> = [
    // Anchored on the subject of the question, not on a bare mention. "Marks"
    // appearing anywhere would swallow "which teacher marks the register";
    // requiring the question to be *about* the topic is what keeps this narrow.
    {
        topic: 'marks, grades and averages',
        pattern: /\b(?:marks?|grades?|scores?|averages?|results?|report cards?|performance|best student|top student|failed|passed|pass rate)\b/i,
    },
    {
        topic: 'student attendance and absences',
        pattern: /\b(?:attendance|absent|absence|absences|absentee|truan\w*|present in class)\b/i,
    },
    {
        topic: 'discipline records',
        pattern: /\b(?:discipline|disciplinary|misconduct|warning letters?|summons|punishment|detention|seized items?|expelled|suspended)\b/i,
    },
    {
        topic: 'payroll and salaries',
        pattern: /\b(?:salary|salaries|payroll|wages?|pay slip|payslip|pay period|allowance)\b/i,
    },
    { topic: 'inventory and stock', pattern: /\b(?:inventory|stock|equipment|store room|storeroom)\b/i },
    { topic: 'announcements and messaging', pattern: /\b(?:announcements?|messages?|notifications?|chat)\b/i },
    { topic: 'nurse visits and sick bay records', pattern: /\b(?:nurse|sick bay|sickbay|infirmary|medical visit)\b/i },
];

export function matchUnrecordedTopic(question: string): string | null {
    for (const { topic, pattern } of UNRECORDED_TOPICS) {
        if (pattern.test(question)) return topic;
    }
    return null;
}

/** Renders the retrieved subset into the block shown to the model. */
export function renderSchema(entries: CatalogEntry[]): string {
    return entries
        .map(e => {
            const lines = [
                `TABLE "${e.table}"`,
                `  purpose: ${e.description}`,
                `  columns: ${e.columns}`,
            ];
            if (e.joins) lines.push(`  joins:   ${e.joins}`);
            return lines.join('\n');
        })
        .join('\n\n');
}
