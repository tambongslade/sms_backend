-- Both columns already existed in schema.prisma but were never given a
-- migration -- most likely applied to some other environment with
-- `prisma db push` and the schema.prisma edit committed without ever running
-- `prisma migrate dev` to capture it. Confirmed by grepping every migration
-- file in this repo for both column names: neither exists anywhere. This on
-- -prem database was consequently missing both columns, which made
-- `prisma.brokenProperty.findMany()` / `prisma.saturdayPunishment.findMany()`
-- fail on every sync run since at least 2026-09-03, and because the sync
-- cursor deliberately never advances past a run with errors, that alone was
-- enough to freeze the whole sync window for two weeks.

-- AlterTable
ALTER TABLE "BrokenProperty" ADD COLUMN "photo_url" TEXT;

-- CreateEnum
CREATE TYPE "SaturdayPunishmentCategory" AS ENUM ('STANDARD', 'CUSTOM', 'EXTRAORDINARY');

-- AlterTable
ALTER TABLE "SaturdayPunishment" ADD COLUMN "reason_category" "SaturdayPunishmentCategory" NOT NULL DEFAULT 'STANDARD';
