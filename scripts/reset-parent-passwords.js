/*
 * Reset every PARENT account to the default password `password123` and flag
 * `must_change_password = true` so they are forced to pick their own on
 * first sign-in.
 *
 * Usage:
 *   node scripts/reset-parent-passwords.js              # dry-run (count only)
 *   node scripts/reset-parent-passwords.js --apply      # actually update
 *
 * Take a database backup before running with --apply.
 */

const bcrypt = require('bcrypt');
const { PrismaClient, Role } = require('@prisma/client');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

if (process.env.NODE_ENV === 'production' && process.env.DATABASE_URL_PRODUCTION) {
    process.env.DATABASE_URL = process.env.DATABASE_URL_PRODUCTION;
}

const prisma = new PrismaClient();

const DEFAULT_PASSWORD = 'password123';
const apply = process.argv.includes('--apply');

async function main() {
    const parentUsers = await prisma.user.findMany({
        where: {
            user_roles: { some: { role: Role.PARENT } },
        },
        select: { id: true, matricule: true, name: true, email: true },
    });

    console.log(`Found ${parentUsers.length} parent account(s).`);

    if (!apply) {
        console.log('\nDry run — no changes written. Re-run with --apply to update.');
        console.log('Sample of the first 5 accounts that would be reset:');
        for (const p of parentUsers.slice(0, 5)) {
            console.log(`  - ${p.matricule ?? '(no matricule)'}  ${p.name}`);
        }
        return;
    }

    const hashed = await bcrypt.hash(DEFAULT_PASSWORD, 10);
    const ids = parentUsers.map((p) => p.id);

    const result = await prisma.user.updateMany({
        where: { id: { in: ids } },
        data: {
            password: hashed,
            must_change_password: true,
        },
    });

    console.log(`\nUpdated ${result.count} parent account(s).`);
    console.log(`Default password: ${DEFAULT_PASSWORD}`);
    console.log('All updated parents will be forced to change their password on next login.');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
