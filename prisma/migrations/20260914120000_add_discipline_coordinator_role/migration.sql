-- Add DISCIPLINE_COORDINATOR to Role and AssignmentRole enums.
--
-- This role sits above DEAN_OF_DISCIPLINE for discipline-side oversight and
-- has personnel-management authority scoped to DMs, SDMs, and DoDs (enforced
-- in the service layer, not just route middleware).
--
-- ALTER TYPE ... ADD VALUE can execute inside a transaction on Postgres 12+;
-- the new value simply cannot be referenced in the same transaction that
-- adds it, which is fine here — no data uses it yet.
ALTER TYPE "Role" ADD VALUE 'DISCIPLINE_COORDINATOR';
ALTER TYPE "AssignmentRole" ADD VALUE 'DISCIPLINE_COORDINATOR';
