/**
 * Hand-written answers for the questions that actually get asked daily.
 *
 * The model generates at ~9 tokens/second, so a generated query costs several
 * seconds before the database is even touched. The common questions are a small,
 * predictable set, and their SQL does not need inventing every time — matching
 * them by pattern answers in milliseconds and leaves the model for the long
 * tail. This is what makes the feature feel fast rather than merely possible.
 *
 * Every query here is parameterised. None interpolates user text.
 */

export interface FastIntent {
    name: string;
    /** Ordered: the first match wins, so put the specific patterns first. */
    patterns: RegExp[];
    /** $1 is the current academic year id; $2 is the captured term when used. */
    sql: string;
    /** Builds extra parameters from the regex match. */
    params?: (m: RegExpMatchArray) => any[];
    /**
     * A last look at a pattern that already matched. Returning false declines
     * it and lets the next intent — or the model — take the question.
     *
     * A regex that captures a name cannot tell a name from a name plus a
     * condition, and it will always prefer to match. This is where that gets
     * caught.
     */
    accept?: (m: RegExpMatchArray) => boolean;
    /** Turns the single result row into a sentence. */
    describe: (row: any, m: RegExpMatchArray) => string;
    /**
     * Whether a non-leadership role may ask this.
     *
     * The assistant is reachable from every dashboard, but "who can open it" and
     * "what it will answer" are different questions. A head count per class is
     * unremarkable; what the school is owed is not something a parent or a
     * teacher should be able to ask, and the free-text path is off for them
     * entirely — an arbitrary SELECT over student records, fees, marks and
     * discipline is the whole school's private data behind one text box.
     */
    general?: boolean;
}

// Enrolment is per academic year, so "how many students" without a year means
// the current one. Every count below is scoped this way.
const CURRENT_YEAR = `(SELECT id FROM "AcademicYear" WHERE is_current = true LIMIT 1)`;

// The Gender enum is exactly two values, Female and Male, capitalised. Anything
// a person might reasonably type has to land on one of them, so the mapping is
// explicit rather than a capitalise-the-first-letter trick that would turn
// "boys" into "Boys" and match nothing.
const GENDER_WORDS: Record<string, 'Male' | 'Female'> = {
    boy: 'Male', boys: 'Male', male: 'Male', males: 'Male',
    girl: 'Female', girls: 'Female', female: 'Female', females: 'Female',
};
/**
 * Words that mean the question carries a condition no hand-written intent can
 * express.
 *
 * A capture group is greedy about names and cannot see that it has swallowed a
 * clause: "how many students in FORM 1 were born in 2010" handed
 * students_in_class the class name "FORM 1 WERE BORN IN 2010", which matched
 * nothing and was reported as a confident zero. The question was answerable —
 * just not by that intent. Declining the match sends it to the model instead,
 * and a slow correct answer beats an instant wrong one.
 */
const QUALIFIER = /\b(?:who|whose|whom|that|which|with|without|born|age[ds]?|owe|owes|owing|debt|paid|pay|pays|unpaid|outstanding|live|lives|living|repeat\w*|new|old|above|below|over|under|more|less|fewer|between|than|before|after|since|during|and|or|not|male|female|boys?|girls?|top|first|last)\b/i;

/** A class or subclass name, as opposed to a name with a condition stuck to it. */
function looksLikeClassName(raw: string): boolean {
    const name = raw.trim();
    if (!name) return false;
    if (name.split(/\s+/).length > 4) return false;
    return !QUALIFIER.test(name);
}

export const FAST_INTENTS: FastIntent[] = [
    {
        // Must precede students_in_class: that pattern captures a trailing
        // phrase as a class name, so "how many students in each class" matched
        // it and searched for a class literally named "EACH CLASS", returning
        // a confident zero. First match wins, so ordering is the fix.
        name: 'class_breakdown',
        general: true,
        patterns: [
            /how many (?:students?|pupils?) (?:are )?(?:in|per) (?:each|every|all) (?:class|classes|form)/i,
            /(?:students?|enrol(?:l)?ment) (?:per|by|in each|for each) class/i,
            /breakdown (?:of )?(?:students?|classes|enrol(?:l)?ment)/i,
            /class (?:sizes?|distribution)/i,
        ],
        sql: `
            SELECT c.name AS class, COUNT(DISTINCT e.student_id)::int AS count
            FROM "Enrollment" e
            JOIN "Class" c ON c.id = e.class_id
            WHERE e.academic_year_id = ${CURRENT_YEAR}
            GROUP BY c.name
            ORDER BY count DESC`,
        describe: () => 'Enrolment by class for the current academic year:',
    },
    {
        name: 'students_in_class',
        general: true,
        patterns: [
            // The negative lookahead is a second guard on the same confusion:
            // even reordered, "in each class" should never be read as a name.
            /how many (?:students?|pupils?|children) (?:are )?(?:in|enrolled in) (?!each|every|all|total)([a-z0-9 ]+?)\??$/i,
            /(?:number|count) of (?:students?|pupils?) in (?!each|every|all)([a-z0-9 ]+?)\??$/i,
        ],
        sql: `
            SELECT COUNT(DISTINCT e.student_id)::int AS count
            FROM "Enrollment" e
            JOIN "Class" c ON c.id = e.class_id
            WHERE e.academic_year_id = ${CURRENT_YEAR}
              AND UPPER(c.name) LIKE UPPER($1)`,
        params: m => [`%${m[1].trim()}%`],
        accept: m => looksLikeClassName(m[1]),
        describe: (row, m) => `${row.count} student${row.count === 1 ? '' : 's'} are enrolled in ${m[1].trim().toUpperCase()} this academic year.`,
    },
    {
        name: 'students_total',
        general: true,
        patterns: [
            /how many (?:students?|pupils?|children)(?: are there| do we have| are enrolled)?\s*(?:in (?:the )?school)?\??$/i,
            /total (?:number of )?(?:students?|pupils?)\??$/i,
        ],
        sql: `
            SELECT COUNT(DISTINCT e.student_id)::int AS count
            FROM "Enrollment" e
            WHERE e.academic_year_id = ${CURRENT_YEAR}`,
        describe: row => `${row.count} students are enrolled this academic year.`,
    },
    {
        name: 'students_owing',
        patterns: [
            /how many (?:students?|pupils?)?\s*(?:are )?(?:owing|owe|in debt|have (?:an )?outstanding)/i,
            /(?:students?|pupils?) (?:who )?(?:owe|owing|have not paid|haven'?t paid)/i,
            /how many (?:have not|haven'?t) paid/i,
        ],
        sql: `
            SELECT COUNT(*)::int AS count,
                   COALESCE(SUM(sf.amount_expected - sf.amount_paid), 0)::bigint AS outstanding
            FROM "SchoolFees" sf
            WHERE sf.academic_year_id = ${CURRENT_YEAR}
              AND sf.amount_expected > sf.amount_paid`,
        describe: row =>
            `${row.count} enrolment${row.count === 1 ? '' : 's'} still owe fees, totalling ${Number(row.outstanding).toLocaleString()} FCFA outstanding.`,
    },
    {
        name: 'fees_collected',
        patterns: [
            // Anchored, with room for the natural trailing phrases. Left open,
            // "how much have we collected in FORM 1" was answered school-wide.
            /how much (?:have we |has been )?(?:collected|received|paid)(?: so far| in total| altogether| this (?:year|term))?\s*\??$/i,
            /total (?:fees )?(?:collected|paid|revenue|income)(?: so far| this (?:year|term))?\s*\??$/i,
        ],
        sql: `
            SELECT COALESCE(SUM(pt.amount), 0)::bigint AS total,
                   COUNT(*)::int AS payments
            FROM "PaymentTransaction" pt
            WHERE pt.academic_year_id = ${CURRENT_YEAR}`,
        describe: row =>
            `${Number(row.total).toLocaleString()} FCFA collected across ${row.payments} payments this academic year.`,
    },
    {
        name: 'expected_total',
        patterns: [
            /how much (?:are we |is )?(?:expect\w*|owed|due)(?: in total| altogether| this (?:year|term))?\s*\??$/i,
            /total (?:fees )?expected(?: this (?:year|term))?\s*\??$/i,
        ],
        sql: `
            SELECT COALESCE(SUM(sf.amount_expected), 0)::bigint AS expected,
                   COALESCE(SUM(sf.amount_paid), 0)::bigint AS paid
            FROM "SchoolFees" sf
            WHERE sf.academic_year_id = ${CURRENT_YEAR}`,
        describe: row => {
            const expected = Number(row.expected);
            const paid = Number(row.paid);
            const pct = expected > 0 ? Math.round((paid / expected) * 100) : 0;
            return `${expected.toLocaleString()} FCFA expected this year; ${paid.toLocaleString()} FCFA collected (${pct}%), leaving ${(expected - paid).toLocaleString()} FCFA outstanding.`;
        },
    },
    {
        name: 'teacher_count',
        general: true,
        patterns: [
            // Anchored: unanchored, "how many teachers are female?" matched
            // here and was answered with the total teacher count.
            /how many (?:teachers?|teaching staff)(?: are there| do we have)?\s*\??$/i,
            /(?:number|count) of (?:teachers?|teaching staff)\s*\??$/i,
        ],
        sql: `
            SELECT COUNT(DISTINCT ur.user_id)::int AS count
            FROM "UserRole" ur
            WHERE ur.role = 'TEACHER'`,
        describe: row => `${row.count} users hold the TEACHER role.`,
    },
    {
        // "How many English teachers are there" was answered with a wrong
        // number, confidently, because the catalog gave the model no path from
        // a subject to a teacher — so it joined something plausible and
        // reported the result. TeacherPeriod is documented now, but a question
        // this ordinary should not depend on the model rediscovering the join
        // each time.
        //
        // Sits after teacher_count deliberately. That intent is anchored so
        // "how many teachers" cannot reach here, and this one requires a word
        // before "teachers" so the bare question cannot reach it either.
        name: 'teachers_for_subject',
        general: true,
        patterns: [
            /how many ([a-z][a-z ]*?) teachers?(?: are there| do we have| are employed)?\s*\??$/i,
            /(?:number|count) of ([a-z][a-z ]*?) teachers?\s*\??$/i,
            /who (?:are|teaches) (?:the )?([a-z][a-z ]*?) teachers?\s*\??$/i,
        ],
        // One row, because describe only ever sees rows[0]. The names are
        // aggregated rather than returned as rows for that reason.
        //
        // COUNT(DISTINCT ...) is not optional: TeacherPeriod holds one row per
        // period taught, so a teacher with eight English lessons a week would
        // otherwise be counted eight times. teacher_id IS NOT NULL excludes the
        // subject-only timetable slots, which carry a subject and no teacher.
        //
        // subject_matches is carried out so describe can tell "no such subject"
        // apart from "a real subject nobody teaches". Collapsing those two into
        // a plain zero is how "how many female teachers" would be answered with
        // a confident 0 rather than an admission that it was not understood.
        sql: `
            WITH subj AS (
                SELECT id, name FROM "Subject" WHERE name ILIKE $1
            ),
            teach AS (
                SELECT DISTINCT tp.teacher_id
                FROM "TeacherPeriod" tp
                JOIN subj ON subj.id = tp.subject_id
                WHERE tp.academic_year_id = ${CURRENT_YEAR}
                  AND tp.teacher_id IS NOT NULL
            )
            SELECT
                (SELECT COUNT(*) FROM subj)::int AS subject_matches,
                (SELECT string_agg(name, ', ' ORDER BY name) FROM subj) AS subjects,
                (SELECT COUNT(*) FROM teach)::int AS count,
                (SELECT string_agg(u.name, ', ' ORDER BY u.name)
                   FROM teach JOIN "User" u ON u.id = teach.teacher_id) AS teachers`,
        params: m => [`%${m[1].trim()}%`],
        // The same guard the class intents use: a capture group cannot tell a
        // subject from a subject plus a condition.
        accept: m => !QUALIFIER.test(m[1]),
        describe: row => {
            if (!row.subject_matches) {
                return `I could not find a subject by that name, so I cannot say how many teachers it has. Ask me about a subject as it is named on the timetable.`;
            }
            if (!row.count) {
                return `No teachers are assigned to ${row.subjects} on this year's timetable.`;
            }
            const one = row.count === 1;
            return `${row.count} teacher${one ? '' : 's'} ${one ? 'teaches' : 'teach'} ${row.subjects} this academic year: ${row.teachers}.`;
        },
    },
    {
        // Must precede gender_split, for exactly the reason class_breakdown
        // must precede students_in_class. gender_split's pattern was
        // /how many (?:boys|girls|male|female)/ with nothing anchoring the
        // end, so "how many males in FORM 1" matched on "male" inside "males",
        // the class was never looked at, and the answer was the whole school's
        // gender split — confident, plausible, and about a different question
        // than the one asked. First match wins, so ordering is half the fix;
        // the anchors on gender_split below are the other half.
        //
        // Matches the class or the subclass: people ask about "FORM 1" and
        // "FORM 1 A" interchangeably, and matching only Class would answer the
        // second with a flat zero.
        name: 'gender_in_class',
        general: true,
        patterns: [
            /how many (boys?|girls?|males?|females?) (?:students? )?(?:are )?(?:there )?(?:in|enrolled in) (?!each|every|all|total|the school|school)([a-z0-9 ]+?)\??$/i,
            /(?:number|count) of (boys?|girls?|males?|females?) (?:students? )?in (?!each|every|all|total|the school|school)([a-z0-9 ]+?)\??$/i,
        ],
        sql: `
            SELECT COUNT(DISTINCT e.student_id)::int AS count
            FROM "Enrollment" e
            JOIN "Student" s ON s.id = e.student_id
            LEFT JOIN "Class" c ON c.id = e.class_id
            LEFT JOIN "SubClass" sc ON sc.id = e.sub_class_id
            WHERE e.academic_year_id = ${CURRENT_YEAR}
              AND s.gender::text = $2
              AND (UPPER(c.name) LIKE UPPER($1) OR UPPER(sc.name) LIKE UPPER($1))`,
        params: m => [`%${m[2].trim()}%`, GENDER_WORDS[m[1].toLowerCase()]],
        accept: m => looksLikeClassName(m[2]),
        describe: (row, m) => {
            const word = GENDER_WORDS[m[1].toLowerCase()] === 'Male' ? 'male' : 'female';
            const one = row.count === 1;
            return `${row.count} ${word} student${one ? '' : 's'} ${one ? 'is' : 'are'} enrolled in ${m[2].trim().toUpperCase()} this academic year.`;
        },
    },
    {
        name: 'gender_split',
        general: true,
        patterns: [
            // Anchored to the end of the question, unlike the original. Left
            // open, it claimed every qualified gender question in the file -
            // "how many males in FORM 1" among them - and answered all of them
            // school-wide. Anything it no longer matches falls to the intent
            // above, or to the model.
            /how many (?:boys?|girls?|males?|females?)(?: students?)?(?: are)?(?: there)?(?: in (?:the )?(?:school|total))?(?: (?:this|the current) (?:academic )?year)?\s*\??$/i,
            /gender (?:split|breakdown|distribution)(?: for (?:the )?(?:school|year))?\s*\??$/i,
        ],
        sql: `
            SELECT s.gender::text AS gender, COUNT(DISTINCT s.id)::int AS count
            FROM "Enrollment" e
            JOIN "Student" s ON s.id = e.student_id
            WHERE e.academic_year_id = ${CURRENT_YEAR}
            GROUP BY s.gender
            ORDER BY count DESC`,
        describe: () => 'Enrolled students by gender this academic year:',
    },
];

export function matchFastIntent(
    question: string,
    generalOnly = false
): { intent: FastIntent; match: RegExpMatchArray } | null {
    const q = question.trim();
    for (const intent of FAST_INTENTS) {
        if (generalOnly && !intent.general) continue;
        for (const pattern of intent.patterns) {
            const m = q.match(pattern);
            if (m && (!intent.accept || intent.accept(m))) return { intent, match: m };
        }
    }
    return null;
}
