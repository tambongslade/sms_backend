import { PrismaClient, Gender, StudentStatus } from '@prisma/client';
import * as dotenv from 'dotenv';
import { createOrUpdateFeeForEnrollment } from '../src/api/v1/services/feeService';

dotenv.config();

const prisma = new PrismaClient();

const ACADEMIC_YEAR_ID = 2; // 2026-2027
const FORM_4_CLASS_ID = 4;
const PLACEHOLDER_DOB = new Date('2010-01-01');
const PLACEHOLDER_POB = 'N/A';
const PLACEHOLDER_RESIDENCE = 'N/A';

type Row = { name: string; gender: Gender };

const subclasses: { subClassId: number; label: string; students: Row[] }[] = [
  {
    subClassId: 30, // FORM 4 MN
    label: '4MN',
    students: [
      { name: 'ABE MANGA MAX', gender: Gender.Male },
      { name: 'ABIGAELLE ELYSEE RUPHINE …', gender: Gender.Female },
      { name: 'AFUMBOM WISDOM-SILAS', gender: Gender.Male },
      { name: "ALAO SIPACK ME'EVA JOSHUA …", gender: Gender.Male },
      { name: 'ANYE SYLVIA', gender: Gender.Female },
      { name: 'ATUD REJOICE JENJOR FAITH', gender: Gender.Female },
      { name: 'AYANGUIMA AMATAGANA CLA…', gender: Gender.Male },
      { name: 'BAMBE MBONDO ETHAN', gender: Gender.Male },
      { name: 'BATJOM MARIE PRINCESS', gender: Gender.Female },
      { name: 'BELINGA AWOMO JOSEPH', gender: Gender.Male },
      { name: 'BENGONO JEAN EVRAD YVANN', gender: Gender.Male },
      { name: 'BINDELE ASSOMO FRANCIS G…', gender: Gender.Male },
      { name: 'DJONTU POKAM RAFAEL KENZO', gender: Gender.Male },
      { name: 'DYOWONG NONO KELAN', gender: Gender.Male },
      { name: 'EGBE AKO KATE JULIA OROCK', gender: Gender.Female },
      { name: 'EROUME AHMED BEN', gender: Gender.Male },
      { name: 'ETORK ELAD JOELAND', gender: Gender.Female },
      { name: 'KENG ABEG DAISY', gender: Gender.Female },
      { name: 'KOTI OLIVIER YVAN RAYAN', gender: Gender.Male },
      { name: 'KOUEMEGNE NDONJI ARISTIDE', gender: Gender.Male },
      { name: 'MAYI HORLANNE SUZANNE', gender: Gender.Female },
      { name: 'MBOUE AMOUGOU MARIANE …', gender: Gender.Female },
      { name: 'MFOUMOU MELI ANAYELLE', gender: Gender.Female },
      { name: 'NANGHA CHRISTEL MYRRHNEH', gender: Gender.Female },
      { name: 'NGANDEU ESSOH DADRIL AIM…', gender: Gender.Male },
      { name: 'NGUENDA ANDREW AXEL U.', gender: Gender.Male },
      { name: 'NJINA HARRY MITCHEL EWANE', gender: Gender.Male },
      { name: 'NJOKE EMILE MASSOMA', gender: Gender.Male },
      { name: 'NSOUKOUA AKWA ANGE', gender: Gender.Female },
      { name: 'OBEN NKI PROMISE', gender: Gender.Male },
      { name: 'TAGOUPO BOGNING SERENA', gender: Gender.Female },
      { name: 'ZOBOME MBARGA ALEXANDR…', gender: Gender.Male },
    ],
  },
  {
    subClassId: 35, // FORM 4 MS
    label: '4MS',
    students: [
      { name: 'ABADA NKWACK MARIE RAPH…', gender: Gender.Female },
      { name: 'ABANG PRAISES NSEN', gender: Gender.Female },
      { name: 'ABEGA MEKEME RAPHAELA A…', gender: Gender.Female },
      { name: 'ADIDJATOU LEILA NDZANA', gender: Gender.Female },
      { name: 'ALAMINE ABUBAKAR NKWE', gender: Gender.Male },
      { name: 'ATIEGETOU ANGEL BRIGHT', gender: Gender.Female },
      { name: 'AYISSI NTANG CLAUDE STEVE…', gender: Gender.Male },
      { name: 'BEZENG NDUM PRINCESS', gender: Gender.Female },
      { name: 'BIH JACKLYN GLORY BIBEHE', gender: Gender.Female },
      { name: 'BOFANO JESSICA', gender: Gender.Female },
      { name: 'BOUES IMBOUEM LEUNIE FLORE', gender: Gender.Female },
      { name: 'DIVINE FAVOUR MOKA NGANJE', gender: Gender.Male },
      { name: 'DONFACK ZEGUE YVAN JASON', gender: Gender.Male },
      { name: 'ENGOUNG DIANE JAELLE LAG…', gender: Gender.Female },
      { name: 'ETOUNGOU MOUSSI', gender: Gender.Male },
      { name: 'FAITH NLAH MIH KWANSUH', gender: Gender.Female },
      { name: 'HANGA OLIVIER JERRY', gender: Gender.Male },
      { name: 'KEMMOE TAKEM ANGE GABIE', gender: Gender.Female },
      { name: 'LENDZZEGUE URIELLA ADRIANA', gender: Gender.Female },
      { name: 'MABWOUA TIWA ANGE RAPHA…', gender: Gender.Female },
      { name: 'MANDJENGUE GRACE ARMELLE', gender: Gender.Female },
      { name: 'MANKAH KEREN HAPPUCH FRU', gender: Gender.Female },
      { name: 'MBAH TCHOUAKAM', gender: Gender.Female },
      { name: 'MBOCK NDJOCK MARELYNE E…', gender: Gender.Female },
      { name: 'MEDJO MEDJO EMMANUEL CY…', gender: Gender.Female },
      { name: 'MEMVOUTA EMVANA ANTONY…', gender: Gender.Female },
      { name: 'MENGUE MARIE', gender: Gender.Female },
      { name: 'MICHELLE DAVILA Ebie Ndzomo', gender: Gender.Female },
      { name: 'MOH Benjamin Ghamntemenyi', gender: Gender.Male },
      { name: 'MONGOH MBONDJO VANELLE …', gender: Gender.Female },
      { name: 'MPEGUE RABIOU MARIE CLAIR', gender: Gender.Female },
      { name: 'NDAMFOR LUTHER HOPE', gender: Gender.Male },
      { name: 'NDJOCK CLAIR STEPHANIE', gender: Gender.Female },
      { name: 'NGAH MEBE FRANCOISE ANG…', gender: Gender.Female },
      { name: 'NGOUMA ATANGANA LEGA GE…', gender: Gender.Female },
      { name: 'NGOUNOU FOKO EVA MACELLE', gender: Gender.Female },
      { name: 'NGOUNOU SIMENI ANGE DANI…', gender: Gender.Male },
      { name: 'NJANG LINDA U.', gender: Gender.Female },
      { name: 'NJOME FESE FLORA NGALE', gender: Gender.Female },
      { name: 'NKOU KABREL', gender: Gender.Male },
      { name: 'NLENG NLENG AMAGNE MARI…', gender: Gender.Female },
      { name: 'NNA MBANG GERMAINE KIKI', gender: Gender.Female },
      { name: 'NNOKE GLENN NUNVIHENE', gender: Gender.Male },
      { name: 'NOGUE TSOLAMA CHRISLAIN', gender: Gender.Male },
      { name: 'NUKAM ELYDIAN WALUMA', gender: Gender.Female },
      { name: 'SAMO BOUKUNDE JOHAN', gender: Gender.Male },
      { name: 'TAMBETABI MAKAYLA EFONDE', gender: Gender.Male },
      { name: 'TANGMOH BRUNDY JOLE', gender: Gender.Male },
      { name: 'TASAH ROY ANKINIMBOM', gender: Gender.Male },
      { name: 'TIOMENE TADAHA OSNIE BLE…', gender: Gender.Female },
      { name: 'TSE KIERRA PERAL', gender: Gender.Female },
      { name: 'VICTOR GREAT PROSPER', gender: Gender.Male },
      { name: 'WATSOP MARTHE DOMINIQUE', gender: Gender.Female },
      { name: 'WIRNGO TESSY BRIGHTEN NY…', gender: Gender.Female },
      { name: 'YEMELON TCHINDA INCRIDE C…', gender: Gender.Female },
      { name: 'ZEUFACK KENFACK YVES CHA…', gender: Gender.Male },
    ],
  },
  {
    subClassId: 5, // FORM 4 M
    label: '4M',
    students: [
      { name: 'ACHIANGRA II Nkemawung Nk…', gender: Gender.Male },
      { name: 'ADA NKOUME ANNE RICHARD', gender: Gender.Female },
      { name: 'AKONO EFFA JOHANN DANIEL', gender: Gender.Male },
      { name: 'ANESTHER HERMANNS EKINY…', gender: Gender.Female },
      { name: 'ASANGA KEREN JOY', gender: Gender.Female },
      { name: 'ASHU BESONG PRIDE', gender: Gender.Male },
      { name: 'ASSONTIA TCHIMETCHI MYRIA…', gender: Gender.Female },
      { name: 'AWA NISSI PENN', gender: Gender.Female },
      { name: 'BAME HENZO KWE', gender: Gender.Male },
      { name: 'BERINYUY DANIELLA', gender: Gender.Female },
      { name: 'BIDMIA CHINDIA CHRISTABEL …', gender: Gender.Female },
      { name: 'BILONG NGUETSA DIVINE', gender: Gender.Female },
      { name: 'BOUSSOURA NANNAWA', gender: Gender.Female },
      { name: 'BTOUOMI NAMO DJOSER', gender: Gender.Male },
      { name: 'CHUKWURA BLESSING IFEOMA', gender: Gender.Female },
      { name: 'CHUKWURA MIRACLE CHIOMA', gender: Gender.Female },
      { name: 'DANCHI DIAMA ANGE GABRIE…', gender: Gender.Female },
      { name: 'EKORONG MBOURI GABRIELL…', gender: Gender.Female },
      { name: 'ESSAPO PAUL', gender: Gender.Male },
      { name: 'ESSOMBA PRISO LEONIE YVA…', gender: Gender.Female },
      { name: 'EWI MAYA KAREN', gender: Gender.Female },
      { name: 'FONCHAM EMMANUEL', gender: Gender.Male },
      { name: 'GODIVA WEPNYU NGAFISON', gender: Gender.Female },
      { name: 'GUIMDO GRACE', gender: Gender.Female },
      { name: 'IGNEPELE RAPHAELLE', gender: Gender.Female },
      { name: 'KENFACK MELABONG', gender: Gender.Male },
      { name: 'KUM CLINTON PAUL AKWO', gender: Gender.Male },
      { name: 'LANGSI IAN SAMJELLA', gender: Gender.Male },
      { name: "LANGSI IVAN SAMGWA'A", gender: Gender.Male },
      { name: 'MAHOP MOPO LOUIS ERWAN', gender: Gender.Male },
      { name: 'MAKAMDEM MALAURY', gender: Gender.Female },
      { name: 'MATALE KADE MYRIAM PRICILE', gender: Gender.Female },
      { name: 'MAYO GABRIEL PERLETTE', gender: Gender.Female },
      { name: 'MBOUTOU ONANA YAN PHILIPPE', gender: Gender.Male },
      { name: 'NAMESSO MBOUNO ALYA JOH…', gender: Gender.Female },
      { name: 'NANE PIERRE ARSENE TOBIE', gender: Gender.Male },
      { name: 'NANGMO TSAFACK ROSY', gender: Gender.Female },
      { name: 'NGO BAGAL ISIS CAMERON', gender: Gender.Female },
      { name: 'NGO BIKIM NYANGONO GABRI…', gender: Gender.Female },
      { name: 'NGOYA KWEMO ANGE MELISSA', gender: Gender.Female },
      { name: 'NGUE CHRISTIAN DIDIEK MIC…', gender: Gender.Male },
      { name: 'NGUEPI HYLARIE CHELSEA', gender: Gender.Female },
      { name: 'NJI KUBONG DANIEL', gender: Gender.Male },
      { name: 'NJUNTSOP KELLY NKOMBUH', gender: Gender.Female },
      { name: 'NKWILANG SEBEB SHEKINA A…', gender: Gender.Female },
      { name: 'NYABA TOWA MARCELLE FOT…', gender: Gender.Female },
      { name: 'NYEMKUNA AUDREY FOYAB', gender: Gender.Female },
      { name: 'OMBE NKOTTO FRANCIS MICH…', gender: Gender.Male },
      { name: 'ONDOA IPPOLITO PATRICK PA…', gender: Gender.Male },
      { name: 'OVAH ESSIMI THERESE DANIE…', gender: Gender.Female },
      { name: 'OWONA NDIE MARY', gender: Gender.Female },
      { name: 'SAAH KUETE TRIPHENE BRIAN…', gender: Gender.Female },
      { name: 'SHEY BEI BERINGNYU FAITH', gender: Gender.Female },
      { name: 'TANA PERFECTION', gender: Gender.Male },
      { name: 'TAWAMBA BASHIRU', gender: Gender.Male },
      { name: 'TCHOUNGA KINGUE IVANA LA…', gender: Gender.Female },
      { name: 'TETOH DALENA NOEL ATANGA', gender: Gender.Female },
      { name: 'TITI REJOICE ETCHICK', gender: Gender.Female },
      { name: 'TOMO TSALA MICHEL', gender: Gender.Male },
      { name: 'TSANE TSAMO ARIEL', gender: Gender.Female },
    ],
  },
  {
    subClassId: 28, // FORM 4 N
    label: '4N',
    students: [
      { name: 'AMBASSA EBOUTOU ISABELLE', gender: Gender.Female },
      { name: 'ANGAFOR IVOLINE', gender: Gender.Female },
      { name: 'BEKONO ARMAND LOIC', gender: Gender.Male },
      { name: 'BEVERLY MAIA ANIMBOM', gender: Gender.Female },
      { name: 'BILONG NZUISSE CINDY CHLOE', gender: Gender.Female },
      { name: 'CHIA RIHANA', gender: Gender.Female },
      { name: 'CHUO JOEL', gender: Gender.Male },
      { name: 'EFU ESTHER EWO', gender: Gender.Female },
      { name: 'ESSONO MENGUE MARIE DUC…', gender: Gender.Female },
      { name: 'EYENGA MENDOUGA GRACE V…', gender: Gender.Female },
      { name: 'FUNWIE CALEB TANWIE', gender: Gender.Male },
      { name: 'GIFT NGIE KEDZE', gender: Gender.Female },
      { name: 'GRACIA NAROKERI BETIKA', gender: Gender.Female },
      { name: 'GRADEL FAITH F.', gender: Gender.Female },
      { name: 'IYONNGA DAVID KYLIAN', gender: Gender.Male },
      { name: 'KAHIYENE MINKA CARLAS', gender: Gender.Female },
      { name: 'KANA ANGE MEGANE', gender: Gender.Female },
      { name: 'KEREL BURINYUY', gender: Gender.Female },
      { name: 'KONNESI JEMIMAH', gender: Gender.Female },
      { name: 'KUM BLESSING NJANG', gender: Gender.Female },
      { name: 'LEPGA FREDRINE SOSIGA', gender: Gender.Female },
      { name: 'LUCHUO MACKDEL NDE', gender: Gender.Male },
      { name: 'MANFO TSAGUE RAPHAELLE', gender: Gender.Female },
      { name: 'MANFO ZANGUE JOSEPH', gender: Gender.Male },
      { name: 'MASSOH TUNTU CLAUDIA', gender: Gender.Female },
      { name: 'MBAH CHRIS-RYAN Mongwe N…', gender: Gender.Male },
      { name: 'MBEZELE FOUOMENE', gender: Gender.Female },
      { name: 'MELANGUIA MENTCHETA KAR…', gender: Gender.Female },
      { name: 'MELI KONM CHLOE', gender: Gender.Female },
      { name: 'MENGUE ETAM ANGE PATRICIA', gender: Gender.Female },
      { name: 'MEVOH CALISHA DANIELS EB…', gender: Gender.Female },
      { name: 'MEYIE BELINGO ROSELIE', gender: Gender.Female },
      { name: 'MORFAW BERTRAND BERINYUY', gender: Gender.Male },
      { name: 'MVOLA MANDENG RUTH', gender: Gender.Female },
      { name: 'NGEW NYINGCHIA E EMMANUEL', gender: Gender.Female },
      { name: 'NGO UM MAYO', gender: Gender.Female },
      { name: 'NOAMBOLO ALBERT LOIC', gender: Gender.Male },
      { name: 'OWONO DAINA VANELLE', gender: Gender.Female },
      { name: 'SENAN LAURETTE CHARLOTTE', gender: Gender.Female },
      { name: 'SUHFOR FAITH NGWE', gender: Gender.Female },
      { name: 'SUINYUY NELLY NOEL SEVIDZ…', gender: Gender.Male },
      { name: 'TADOUM MASSOH CLERIBEL', gender: Gender.Female },
      { name: 'TAGUENA DJOUMESSI O.', gender: Gender.Female },
      { name: 'TAMFU COWIN NFONJE', gender: Gender.Female },
      { name: 'TCHOUGA TEDE ADRIENNE KE…', gender: Gender.Female },
      { name: 'TOHNIAN AMANDA', gender: Gender.Female },
      { name: 'WANCHA BONGSEL PURITY', gender: Gender.Female },
      { name: 'WEHFON GREAT ROY', gender: Gender.Male },
      { name: 'YENIKA RYAN DENIS VERNYUY', gender: Gender.Male },
      { name: 'YIDIGOU MENTI HENRI PHINEES', gender: Gender.Male },
    ],
  },
  {
    subClassId: 9, // FORM 4 S
    label: '4S',
    students: [
      { name: 'MBOUAGOURE PECHANGOU A…', gender: Gender.Female },
      { name: 'BILONG NGOUTANE MARIE-AN…', gender: Gender.Female },
      { name: 'MBE DEFFO EMMANUEL', gender: Gender.Male },
      { name: 'MESSI MESSI LEONEL', gender: Gender.Male },
      { name: 'NYOH DEVAN ANGEL', gender: Gender.Male },
      { name: 'NDIFUSAH AFFANA ALPHA SA…', gender: Gender.Male },
      { name: 'PENKA DONFACK SOLENDA', gender: Gender.Female },
      { name: 'BOUNOUNG NDOUMOU ONDOA', gender: Gender.Female },
      { name: 'DOUM MOTANOC PIERRE', gender: Gender.Male },
      { name: 'PEJOSEM KELEGUEM NATHAN', gender: Gender.Male },
      { name: 'WIRSIY LEONEL SOHLIWIR', gender: Gender.Male },
      { name: 'MBOUNLOUOU NZANG LEA BE…', gender: Gender.Female },
      { name: 'AKWEN ANGEL LINDA', gender: Gender.Female },
      { name: 'TIWARA RHEMA ANNE', gender: Gender.Female },
      { name: 'KISEEVI FRANCIS AKONGMO …', gender: Gender.Male },
      { name: 'MOTALE TEDD FARREL', gender: Gender.Male },
      { name: 'SANYUY PRECIOUS BURINYUY', gender: Gender.Female },
      { name: 'BLESSING GUNYONGA TITAND…', gender: Gender.Female },
      { name: 'FOUMBA NOAH MAEL JOEL', gender: Gender.Male },
      { name: 'KECHAH EMMANUEL TEM', gender: Gender.Male },
      { name: 'NGUNE PROSPERITY EDIE', gender: Gender.Male },
      { name: 'NGUM NDEMEKONG RITCHEOUS', gender: Gender.Female },
      { name: 'WAAH ANYE HELMIA BROWN', gender: Gender.Female },
      { name: 'OFFA SOKBA ANDY RAPHAEL …', gender: Gender.Male },
      { name: 'IGIRANEZA RACHEL', gender: Gender.Female },
      { name: 'AMPALA ABEDIE EANGELY', gender: Gender.Female },
      { name: 'NANGA ONANA ANDRE DIMITRI', gender: Gender.Male },
      { name: 'SIMO KENMONGE BRAYANE', gender: Gender.Male },
      { name: 'NGOUFFOU AWOUNFOUO CH…', gender: Gender.Female },
      { name: 'IDRISSOU ABDUL-AZIZ', gender: Gender.Male },
      { name: 'BABENA BALIABA MANUEL LY…', gender: Gender.Male },
      { name: 'FONYUY TRACY FOMONYUY', gender: Gender.Female },
      { name: 'MBUH BLAISSING AGENUI', gender: Gender.Female },
      { name: 'NANA DARREN DJANKOU', gender: Gender.Female },
      { name: 'FOPA BOGNING YANNTS', gender: Gender.Male },
      { name: 'ALANG YONDA FRANCOISE LA…', gender: Gender.Female },
      { name: 'YUH SUCCESS ABENGYENG', gender: Gender.Female },
      { name: 'RHEMA EMMANUEL PENEL FO…', gender: Gender.Male },
      { name: 'NGWA BONGWI PASSIONATE', gender: Gender.Male },
      { name: 'YOUNYI LYDRICK MAWAH', gender: Gender.Female },
      { name: 'NKONUI DJOUMESSI MERVEILLE', gender: Gender.Female },
      { name: 'SHIWOH LUM FARIDA KIMORA', gender: Gender.Female },
      { name: 'NGOUMNAI NGANKAM TEDDIE', gender: Gender.Female },
      { name: 'DOUYGAI SAKAVA ADELAIDE …', gender: Gender.Female },
      { name: 'KERIS TAMBONG', gender: Gender.Female },
      { name: 'WAIMOH QUEEN ADORA NDUM', gender: Gender.Female },
      { name: 'ACSA ZE', gender: Gender.Female },
      { name: 'BITOMO AMVENE JEAN', gender: Gender.Male },
      { name: 'MBIA OMBAKANE CHRISTIANE…', gender: Gender.Female },
      { name: 'FONYUY ELCY LEINYUY', gender: Gender.Female },
      { name: 'PENKA NGUEDIA YANIRA', gender: Gender.Female },
      { name: 'BOUJEKA TERRY-BRIGHT TALA', gender: Gender.Male },
      { name: 'DJOUMESSI NDJIANKAM', gender: Gender.Male },
      { name: 'MOKAM MAELL ALEXIA', gender: Gender.Female },
      { name: 'SONGO ANCEL LEGRAD', gender: Gender.Male },
      { name: 'MUJUNG PHILLIPIAN MUNOH', gender: Gender.Male },
      { name: 'TINWA KOUEDAKIA FRAICHNE…', gender: Gender.Female },
      { name: 'MEYANIE MARY ALISA', gender: Gender.Female },
      { name: 'DJUIKEM LANDO SCHEKINA', gender: Gender.Female },
      { name: 'KEUBOU MESSINA CHIS ANTO…', gender: Gender.Male },
    ],
  },
];

async function main() {
  // Verify anchors exist
  const [year, klass] = await Promise.all([
    prisma.academicYear.findUnique({ where: { id: ACADEMIC_YEAR_ID } }),
    prisma.class.findUnique({ where: { id: FORM_4_CLASS_ID } }),
  ]);
  if (!year) throw new Error(`AcademicYear ${ACADEMIC_YEAR_ID} not found`);
  if (!klass) throw new Error(`Class ${FORM_4_CLASS_ID} (FORM 4) not found`);

  // Determine starting matricule sequence for SS26CL prefix
  const lastCL = await prisma.student.findFirst({
    where: { matricule: { startsWith: 'SS26CL' } },
    orderBy: { matricule: 'desc' },
    select: { matricule: true },
  });
  let nextSeq = lastCL ? parseInt(lastCL.matricule.slice(6), 10) + 1 : 1;

  let totalCreated = 0;
  let totalSkipped = 0;

  for (const bucket of subclasses) {
    const sub = await prisma.subClass.findUnique({ where: { id: bucket.subClassId } });
    if (!sub) throw new Error(`SubClass ${bucket.subClassId} (${bucket.label}) not found`);

    console.log(`\n=== ${bucket.label} (SubClass ${sub.id} / ${sub.name}) — ${bucket.students.length} students ===`);

    for (const row of bucket.students) {
      const cleanName = row.name.trim();

      const existing = await prisma.student.findFirst({
        where: { name: cleanName },
        include: { enrollments: { where: { academic_year_id: ACADEMIC_YEAR_ID } } },
      });

      if (existing) {
        if (existing.enrollments.length > 0) {
          console.log(`  [skip] ${cleanName} already enrolled for ${year.name}`);
          totalSkipped += 1;
          continue;
        }
        const reEnrollment = await prisma.enrollment.create({
          data: {
            student_id: existing.id,
            academic_year_id: ACADEMIC_YEAR_ID,
            class_id: FORM_4_CLASS_ID,
            sub_class_id: bucket.subClassId,
            repeater: false,
          },
        });
        await prisma.student.update({
          where: { id: existing.id },
          data: { status: StudentStatus.ASSIGNED_TO_CLASS },
        });
        // The normal enroll/assign-class API paths always create a SchoolFees
        // row alongside the enrollment; this script skipped it originally,
        // which left 28 students invisible to the bursar's fee search until
        // scripts/backfill-missing-fees-2026.ts caught up the gap.
        await createOrUpdateFeeForEnrollment(reEnrollment.id, FORM_4_CLASS_ID);
        console.log(`  [enroll] existing ${existing.matricule} — ${cleanName}`);
        totalCreated += 1;
        continue;
      }

      const matricule = `SS26CL${String(nextSeq).padStart(4, '0')}`;
      nextSeq += 1;

      const { enrollment: newEnrollment } = await prisma.$transaction(async (tx) => {
        const student = await tx.student.create({
          data: {
            matricule,
            name: cleanName,
            date_of_birth: PLACEHOLDER_DOB,
            place_of_birth: PLACEHOLDER_POB,
            gender: row.gender,
            residence: PLACEHOLDER_RESIDENCE,
            is_new_student: false,
            status: StudentStatus.ASSIGNED_TO_CLASS,
          },
        });
        const enrollment = await tx.enrollment.create({
          data: {
            student_id: student.id,
            academic_year_id: ACADEMIC_YEAR_ID,
            class_id: FORM_4_CLASS_ID,
            sub_class_id: bucket.subClassId,
            repeater: false,
          },
        });
        return { student, enrollment };
      });
      // Outside the transaction, same reasoning as the re-enroll path above --
      // createOrUpdateFeeForEnrollment runs on the plain prisma client, not tx.
      await createOrUpdateFeeForEnrollment(newEnrollment.id, FORM_4_CLASS_ID);

      console.log(`  [create] ${matricule} — ${cleanName} (${row.gender})`);
      totalCreated += 1;
    }

    // Recompute current_students from actual enrollments
    const count = await prisma.enrollment.count({
      where: { sub_class_id: bucket.subClassId, academic_year_id: ACADEMIC_YEAR_ID },
    });
    await prisma.subClass.update({
      where: { id: bucket.subClassId },
      data: { current_students: count },
    });
    console.log(`  → ${bucket.label}.current_students set to ${count}`);
  }

  console.log(`\nDONE. Created/enrolled: ${totalCreated}. Skipped (already enrolled): ${totalSkipped}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
