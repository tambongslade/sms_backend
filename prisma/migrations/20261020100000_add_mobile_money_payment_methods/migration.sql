-- M1: Cash already exists in the enum; add the two mobile-money operators.
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block on older
-- PostgreSQL versions; Prisma runs each migration file on its own, and
-- IF NOT EXISTS keeps it idempotent on nodes that already have the values.
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'MTN_MOMO';
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'ORANGE_MONEY';
