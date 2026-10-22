-- Merge of the online server's work: reason (disciplinary action) and estimated_cost (broken
-- property) are optional there. Dropping NOT NULL only relaxes a constraint; no rows change.
ALTER TABLE "DisciplinaryAction" ALTER COLUMN "reason" DROP NOT NULL;
ALTER TABLE "BrokenProperty" ALTER COLUMN "estimated_cost" DROP NOT NULL;
