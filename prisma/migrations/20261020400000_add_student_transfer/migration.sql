-- U13: transfer-out record + leaving certificate. Additive only (new table + FK to Student).
-- NOT applied automatically: run `npx prisma migrate deploy` (then `npx prisma generate`,
-- `npm run build`, restart) when ready.
CREATE TABLE "StudentTransfer" (
    "id" SERIAL NOT NULL,
    "student_id" INTEGER NOT NULL,
    "academic_year_id" INTEGER,
    "transfer_date" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "destination_school" TEXT,
    "remarks" TEXT,
    "last_class_name" TEXT,
    "certificate_number" TEXT NOT NULL,
    "recorded_by_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "server_id" TEXT,
    "checksum" TEXT,

    CONSTRAINT "StudentTransfer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StudentTransfer_certificate_number_key" ON "StudentTransfer"("certificate_number");
CREATE INDEX "StudentTransfer_student_id_idx" ON "StudentTransfer"("student_id");

ALTER TABLE "StudentTransfer" ADD CONSTRAINT "StudentTransfer_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
