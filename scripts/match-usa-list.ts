/**
 * Match the prospective USA1 / USA2 rosters for 2026/2027 against the
 * students already in the database.
 *
 * Report-only by default. Pass `--commit` to actually create/update the
 * enrollments into UPPER SIXTH A1 (subclass id 7) and UPPER SIXTH A2
 * (subclass id 10) for academic year 2 (2026-2027).
 */

import prisma from '../src/config/db';

const ACADEMIC_YEAR_ID = 2;
const CLASS_ID = 5;               // UPPER SIXTH ARTS
const USA1_SUBCLASS_ID = 7;
const USA2_SUBCLASS_ID = 10;

const USA1_NAMES = [
    'ABONDO VLADINIR LEDOUX',
    'ASSOMO ATANGANA LUCIE LEA',
    'AWAH MARLEY',
    'AYGEN NOELLA ACHIRI',
    'BAKOP EDO\'O MBELECK DIVIN',
    'BAMA NELLY NSEI',
    'BEMANI MARIELLA AZALA',
    'BIKOI LANEY MARCIAF LAVIE',
    'BIKONGNYUY YVAN WOMO',
    'BILOA TCHAPMY MANUELLA D',
    'DJANKOU NKUISSI MARCI RA',
    'EGBE CHRISMARIO NCHI AYUK',
    'ENA MANGA ISMAELLA',
    'ENDUM SHARENCE BABILA',
    'ESSOMBA LEKA MARIVANE GL',
    'ETEME AKON ESTHER DANIELLE',
    'EVINA SEME MARIE',
    'FESSIE KAVA MICHEL ANTONY',
    'FOKO TOUMWO RACHEL BRU',
    'FOUELEFACK DEMANOU SERE',
    'FRU DARRIN NDE',
    'GALIA EDJE\'E THIERRY MIGUEL',
    'INOUSSA ISSA',
    'KAOBA LAWAREWA MERVIELLE',
    'KEZIAH MBI NGHA KAH',
    'KONGSO CLAUDIA KENYUYFON',
    'KUM STACY JOY EWO',
    'LEMOUPA BELVANIE',
    'MADJOU TESSA ANGELLA PRI',
    'MAIMOUNA TOUKOUR YAYA',
    'MARIA GORETTI WIRNYU',
    'MARK CHIA ANKINIMBOM',
    'MEBENGA ESSONO JOSEPH',
    'MEKEMKING FOSSO GRACE',
    'MEKEU REINE MYLAND',
    'MERCEDES NGASSAM EBONG',
    'NANFACK TESSEMO NOELLA',
    'NGOLE NDILLE DARLENE AHO',
    'NGUFOR RAPHA CHI',
    'OFUNDEM MAWOH MARIA LIZ',
    'TEKWE FAVOUR NGOCHAN',
    'TINDO ANYIAJONG NKEMAWO',
    'TSAFACK NGATCHOUA FRANC',
    'TSOPJIO MARC AZRIEL',
    'VICTORY ESTHER ACHUO',
];

const USA2_NAMES = [
    'ABILA NAOMI SANDRA',
    'ACHA PRECIOUS TEKOE',
    'ACHA ROMEO ACHA',
    'ADA AYI JULES MANUELY',
    'AGENUI KELDA BIH',
    'AKEM SMITHDRICK KETUMA',
    'ANYEN FAVOUR',
    'AOUATSOP KAMNO GRACE',
    'ASHLEY NGAFFISON NGINYUY',
    'CHRISTELLE RINYUY NDI',
    'LONGLA KENNE PRECIOUS',
    'METILA JIOGO LORENE',
    'MOHAMADOU AQIL BILIANINI',
    'MOLAH DANIELLA NGWINDONG',
    'MONDIT NOURIATOU',
    'MOTALE KHARREL ADA’AMA',
    'MUJUNG URIELL FORCHU',
    'NAGUE KENFACK JOYCE ELLA',
    'NANFANG NONO ORI MAE',
    'NFORNGWA BRIAN TANTOH',
    'NGAH OMGBA LUCILE VICTOR',
    'NGOLE NDILLE DARREL',
    'NGUEPI ZAMBOU STACY',
    'NGUESSOP MAKAMTE CHELSI',
    'NGUM BLESSING FAVOUR MA',
    'NGUM DESTINY AKONWI',
    'NGWA KETCHAM MAXWELL',
    'NGWENYIE GLORY',
    'NJECK PROMISE TABOH',
    'NJEYIHA BRICE MADELEINE',
    'NKWA NJIE LESLY AYUK',
    'NYEMB BERTHE FLEUR',
    'SAMUEL BAWACK TAKOETA',
    'TAKOUMBO TOUSSE LABELLE',
    'TEUWA KADJI RUDY EMMANUEL',
    'TONTSA GLORIA',
    'WADO DOUNGUE CABREL',
    'WANDJI DARLIA NJANKOU',
    'YETI BERACAH SEMA',
    'ZO\'O NGUEMA KEYLAN SAMUEL',
];

// Normalise: uppercase, strip apostrophes and diacritics, collapse whitespace.
const normalise = (s: string) =>
    s
        .toUpperCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[''’`]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

type Candidate = { id: number; matricule: string; name: string; normName: string };

interface Match {
    listName: string;
    normListName: string;
    matches: Candidate[];
}

const commit = process.argv.includes('--commit');

async function main() {
    const students = await prisma.student.findMany({
        select: { id: true, matricule: true, name: true },
    });
    const candidates: Candidate[] = students.map(s => ({ ...s, normName: normalise(s.name) }));

    // Existing enrollments for the target year, keyed by student id.
    const existingEnrollments = await prisma.enrollment.findMany({
        where: { academic_year_id: ACADEMIC_YEAR_ID },
        select: { id: true, student_id: true, sub_class_id: true, class_id: true },
    });
    const enrollmentByStudent = new Map(existingEnrollments.map(e => [e.student_id, e]));

    const rosters: { label: string; subClassId: number; names: string[] }[] = [
        { label: 'USA1 (UPPER SIXTH A1)', subClassId: USA1_SUBCLASS_ID, names: USA1_NAMES },
        { label: 'USA2 (UPPER SIXTH A2)', subClassId: USA2_SUBCLASS_ID, names: USA2_NAMES },
    ];

    let totalMatched = 0;
    let totalMissing = 0;
    let totalAmbiguous = 0;
    let totalAlreadyCorrect = 0;
    let totalMoved = 0;
    let totalNewEnroll = 0;

    for (const roster of rosters) {
        console.log(`\n=== ${roster.label} — ${roster.names.length} names ===`);
        const missing: string[] = [];
        const ambiguous: Match[] = [];
        const resolved: { listName: string; match: Candidate }[] = [];

        for (const listName of roster.names) {
            const norm = normalise(listName);

            // Exact normalised match first.
            let hits = candidates.filter(c => c.normName === norm);

            // Fall back to prefix — the source list truncates long names with "…".
            if (hits.length === 0) {
                hits = candidates.filter(c => c.normName.startsWith(norm) || norm.startsWith(c.normName));
            }

            // Last resort: token-set match (all tokens of the shorter one appear
            // in the longer one). Catches minor word-order or truncation issues.
            if (hits.length === 0) {
                const listTokens = norm.split(' ').filter(Boolean);
                hits = candidates.filter(c => {
                    const dbTokens = c.normName.split(' ').filter(Boolean);
                    const [short, long] = listTokens.length <= dbTokens.length
                        ? [listTokens, dbTokens]
                        : [dbTokens, listTokens];
                    if (short.length < 2) return false;
                    return short.every(t => long.includes(t));
                });
            }

            if (hits.length === 0) {
                missing.push(listName);
                totalMissing++;
            } else if (hits.length > 1) {
                ambiguous.push({ listName, normListName: norm, matches: hits });
                totalAmbiguous++;
            } else {
                resolved.push({ listName, match: hits[0] });
                totalMatched++;
            }
        }

        console.log(`  Matched:   ${resolved.length}`);
        console.log(`  Missing:   ${missing.length}`);
        console.log(`  Ambiguous: ${ambiguous.length}`);

        if (resolved.length) {
            console.log('\n  Matched students:');
            for (const r of resolved) {
                const existing = enrollmentByStudent.get(r.match.id);
                let status = 'new';
                if (existing) {
                    if (existing.sub_class_id === roster.subClassId) {
                        status = 'already in target subclass';
                        totalAlreadyCorrect++;
                    } else {
                        status = `move from subclass ${existing.sub_class_id ?? '(none)'} → ${roster.subClassId}`;
                        totalMoved++;
                    }
                } else {
                    totalNewEnroll++;
                }
                console.log(`    - [${r.match.matricule}] ${r.match.name}  (${status})`);
            }
        }

        if (missing.length) {
            console.log('\n  NOT FOUND (create manually or check spelling):');
            for (const m of missing) console.log(`    - ${m}`);
        }

        if (ambiguous.length) {
            console.log('\n  AMBIGUOUS (multiple students matched, needs human pick):');
            for (const a of ambiguous) {
                console.log(`    ! "${a.listName}"`);
                for (const c of a.matches) console.log(`        → [${c.matricule}] ${c.name}`);
            }
        }
    }

    console.log(`\n=== Summary ===`);
    console.log(`  Total matched: ${totalMatched}`);
    console.log(`  Total missing: ${totalMissing}`);
    console.log(`  Total ambiguous: ${totalAmbiguous}`);
    console.log(`  Already in target subclass: ${totalAlreadyCorrect}`);
    console.log(`  Would MOVE to target subclass: ${totalMoved}`);
    console.log(`  Would CREATE new enrollment: ${totalNewEnroll}`);

    if (!commit) {
        console.log('\n(dry run — re-run with --commit to persist the enrollments)');
        return;
    }

    console.log('\n=== Applying enrollments ===');

    let applied = 0;
    for (const roster of rosters) {
        for (const listName of roster.names) {
            const norm = normalise(listName);
            let hits = candidates.filter(c => c.normName === norm);
            if (hits.length === 0) hits = candidates.filter(c => c.normName.startsWith(norm) || norm.startsWith(c.normName));
            if (hits.length === 0) {
                const listTokens = norm.split(' ').filter(Boolean);
                hits = candidates.filter(c => {
                    const dbTokens = c.normName.split(' ').filter(Boolean);
                    const [short, long] = listTokens.length <= dbTokens.length ? [listTokens, dbTokens] : [dbTokens, listTokens];
                    if (short.length < 2) return false;
                    return short.every(t => long.includes(t));
                });
            }
            if (hits.length !== 1) continue; // Skip missing + ambiguous.

            const student = hits[0];
            const existing = enrollmentByStudent.get(student.id);

            if (existing) {
                if (existing.sub_class_id === roster.subClassId && existing.class_id === CLASS_ID) continue;
                await prisma.enrollment.update({
                    where: { id: existing.id },
                    data: { sub_class_id: roster.subClassId, class_id: CLASS_ID },
                });
            } else {
                await prisma.enrollment.create({
                    data: {
                        student_id: student.id,
                        academic_year_id: ACADEMIC_YEAR_ID,
                        class_id: CLASS_ID,
                        sub_class_id: roster.subClassId,
                    },
                });
            }
            applied++;
        }
    }
    console.log(`Applied ${applied} enrollment writes.`);
}

main()
    .catch(e => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
