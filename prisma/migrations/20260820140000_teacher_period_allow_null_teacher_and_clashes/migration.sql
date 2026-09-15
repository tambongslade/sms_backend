-- Allow subject-only timetable slots and permit teacher clashes with a warning.

-- 1. Drop the FK so we can relax teacher_id, then re-add it as SET NULL on delete.
ALTER TABLE "TeacherPeriod" DROP CONSTRAINT IF EXISTS "TeacherPeriod_teacher_id_fkey";

-- 2. Make teacher_id nullable.
ALTER TABLE "TeacherPeriod" ALTER COLUMN "teacher_id" DROP NOT NULL;

-- 3. Re-attach the FK, keeping the original ON UPDATE CASCADE / ON DELETE RESTRICT
--    behaviour Prisma emits for optional relations of this shape.
ALTER TABLE "TeacherPeriod"
  ADD CONSTRAINT "TeacherPeriod_teacher_id_fkey"
  FOREIGN KEY ("teacher_id") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 4. Drop the unique index that prevented a teacher being booked in two
--    subclasses at the same period_id — clashes are now warnings, not errors.
--    Prisma emits @@unique as a plain unique index in older migrations, so we
--    drop the index (which covers the constraint too).
ALTER TABLE "TeacherPeriod"
  DROP CONSTRAINT IF EXISTS "TeacherPeriod_teacher_id_period_id_academic_year_id_key";
DROP INDEX IF EXISTS "TeacherPeriod_teacher_id_period_id_academic_year_id_key";
