/**
 * Create the 30 not-found USA1 / USA2 students with placeholder values
 * so they can be edited in the UI, then enroll them into their subclass.
 *
 * Placeholders:
 *   - matricule:      SS26CL0259, SS26CL0260, … (auto-incremented from max)
 *   - date_of_birth:  2005-01-01 (typical Upper Sixth age)
 *   - place_of_birth: 'TBD'
 *   - gender:         'FEMALE' by default — flip in the UI where wrong
 *   - residence:      'TBD'
 *
 * Dry-run by default. Pass `--commit` to persist.
 */

import prisma, { Gender } from '../src/config/db';

const ACADEMIC_YEAR_ID = 2;
const CLASS_ID = 5; // UPPER SIXTH ARTS
const USA1_SUBCLASS_ID = 7;
const USA2_SUBCLASS_ID = 10;

const USA1_MISSING = [
    'ABONDO VLADINIR LEDOUX',
    'AYGEN NOELLA ACHIRI',
    "BAKOP EDO'O MBELECK DIVIN",
    'BEMANI MARIELLA AZALA',
    'ENDUM SHARENCE BABILA',
    'ETEME AKON ESTHER DANIELLE',
    'FOKO TOUMWO RACHEL BRU',
    'KEZIAH MBI NGHA KAH',
    'MARIA GORETTI WIRNYU',
    'MARK CHIA ANKINIMBOM',
    'NANFACK TESSEMO NOELLA',
    'TEKWE FAVOUR NGOCHAN',
    'TINDO ANYIAJONG NKEMAWO',
];

const USA2_MISSING = [
    'ABILA NAOMI SANDRA',
    'AGENUI KELDA BIH',
    'AKEM SMITHDRICK KETUMA',
    'ANYEN FAVOUR',
    'CHRISTELLE RINYUY NDI',
    'LONGLA KENNE PRECIOUS',
    'MOLAH DANIELLA NGWINDONG',
    'NAGUE KENFACK JOYCE ELLA',
    'NANFANG NONO ORI MAE',
    'NFORNGWA BRIAN TANTOH',
    'NGUM DESTINY AKONWI',
    'NJEYIHA BRICE MADELEINE',
    'NYEMB BERTHE FLEUR',
    'TAKOUMBO TOUSSE LABELLE',
    'TONTSA GLORIA',
    'WANDJI DARLIA NJANKOU',
    'YETI BERACAH SEMA',
];

// Male-sounding first names (rough — user can flip in the UI). Everything else
// defaults to FEMALE because the roster skews female. This just seeds a sane
// starting value.
const LIKELY_MALE_TOKENS = new Set([
    'VLADINIR', 'LEDOUX', 'DIVIN', 'MARK', 'CHIA', 'ANKINIMBOM',
    'BRICE', 'SMITHDRICK', 'BRIAN', 'CABREL',
]);

const guessGender = (name: string): Gender => {
    const tokens = name.toUpperCase().split(/\s+/);
    return (tokens.some(t => LIKELY_MALE_TOKENS.has(t)) ? 'Male' : 'Female') as Gender;
};

const commit = process.argv.includes('--commit');

async function main() {
    // Next matricule number.
    const maxMatricule = await prisma.student.findFirst({
        where: { matricule: { startsWith: 'SS26CL' } },
        orderBy: { matricule: 'desc' },
        select: { matricule: true },
    });
    let nextSeq = maxMatricule ? parseInt(maxMatricule.matricule.slice(6), 10) + 1 : 1;
    console.log(`Starting matricule sequence at SS26CL${String(nextSeq).padStart(4, '0')}`);

    const rosters = [
        { label: 'USA1', subClassId: USA1_SUBCLASS_ID, names: USA1_MISSING },
        { label: 'USA2', subClassId: USA2_SUBCLASS_ID, names: USA2_MISSING },
    ];

    for (const roster of rosters) {
        console.log(`\n=== ${roster.label} (${roster.names.length} to create) ===`);
        for (const name of roster.names) {
            const matricule = `SS26CL${String(nextSeq).padStart(4, '0')}`;
            const gender = guessGender(name);
            nextSeq++;

            console.log(`  ${matricule}  ${name}  [${gender}]`);

            if (!commit) continue;

            const student = await prisma.student.create({
                data: {
                    matricule,
                    name,
                    date_of_birth: new Date('2005-01-01'),
                    place_of_birth: 'TBD',
                    gender,
                    residence: 'TBD',
                    is_new_student: false,
                    status: 'ENROLLED',
                    admission_academic_year_id: ACADEMIC_YEAR_ID,
                    first_enrollment_year_id: ACADEMIC_YEAR_ID,
                },
            });

            await prisma.enrollment.create({
                data: {
                    student_id: student.id,
                    academic_year_id: ACADEMIC_YEAR_ID,
                    class_id: CLASS_ID,
                    sub_class_id: roster.subClassId,
                },
            });
        }
    }

    if (!commit) {
        console.log('\n(dry run — re-run with --commit to persist)');
    } else {
        console.log('\nDone.');
    }
}

main()
    .catch(e => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
