// One-off backfill: 28 students imported by scripts/import-form4-2026.ts got a
// Student + Enrollment row but no SchoolFees row -- that script never called
// createOrUpdateFeeForEnrollment the way the normal enroll/assign-class API
// paths do. Result: the bursar's fee search (GET /fees?search=...) queries
// SchoolFees, so these students were invisible there even though they exist
// and are properly enrolled. Reuses the same fee-calculation function the
// live endpoints use, so amounts match what a normal enrollment would get.
import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import { createOrUpdateFeeForEnrollment } from '../src/api/v1/services/feeService';

dotenv.config();
const prisma = new PrismaClient();

async function main() {
    const missing = await prisma.enrollment.findMany({
        where: { school_fees: { none: {} } },
        include: { student: { select: { id: true, name: true, matricule: true } } },
    });

    if (missing.length === 0) {
        console.log('No enrollments missing a SchoolFees record. Nothing to do.');
        return;
    }

    console.log(`Found ${missing.length} enrollment(s) with no SchoolFees record:\n`);
    let created = 0;
    let failed = 0;
    for (const e of missing) {
        try {
            const fee = await createOrUpdateFeeForEnrollment(e.id, e.class_id!);
            console.log(`  [created] enrollment ${e.id} — ${e.student.matricule} ${e.student.name} — expected ${fee.amount_expected}`);
            created += 1;
        } catch (err: any) {
            console.error(`  [FAILED] enrollment ${e.id} — ${e.student.matricule} ${e.student.name}: ${err.message}`);
            failed += 1;
        }
    }

    console.log(`\nDONE. Created: ${created}. Failed: ${failed}.`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
