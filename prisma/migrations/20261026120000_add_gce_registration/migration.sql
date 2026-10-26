-- CreateEnum
CREATE TYPE "GceExamLevel" AS ENUM ('O_LEVEL', 'A_LEVEL');

-- CreateTable
CREATE TABLE "GceRegistration" (
    "id" SERIAL NOT NULL,
    "enrollment_id" INTEGER NOT NULL,
    "academic_year_id" INTEGER NOT NULL,
    "exam_level" "GceExamLevel" NOT NULL,
    "amount_expected" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "amount_paid" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_by_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "server_id" TEXT,
    "checksum" TEXT,

    CONSTRAINT "GceRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GceRegistrationSubject" (
    "id" SERIAL NOT NULL,
    "gce_registration_id" INTEGER NOT NULL,
    "subject_id" INTEGER NOT NULL,
    "is_practical" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "server_id" TEXT,
    "checksum" TEXT,

    CONSTRAINT "GceRegistrationSubject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GceRegistrationPayment" (
    "id" SERIAL NOT NULL,
    "gce_registration_id" INTEGER NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "payment_date" TIMESTAMP(3) NOT NULL,
    "receipt_number" TEXT,
    "payment_method" "PaymentMethod" NOT NULL,
    "recorded_by_id" INTEGER NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "server_id" TEXT,
    "checksum" TEXT,

    CONSTRAINT "GceRegistrationPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GceRegistration_enrollment_id_academic_year_id_key" ON "GceRegistration"("enrollment_id", "academic_year_id");

-- CreateIndex
CREATE UNIQUE INDEX "GceRegistrationSubject_gce_registration_id_subject_id_key" ON "GceRegistrationSubject"("gce_registration_id", "subject_id");

-- CreateIndex
CREATE INDEX "GceRegistrationPayment_gce_registration_id_idx" ON "GceRegistrationPayment"("gce_registration_id");

-- AddForeignKey
ALTER TABLE "GceRegistration" ADD CONSTRAINT "GceRegistration_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "Enrollment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GceRegistration" ADD CONSTRAINT "GceRegistration_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GceRegistration" ADD CONSTRAINT "GceRegistration_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GceRegistrationSubject" ADD CONSTRAINT "GceRegistrationSubject_gce_registration_id_fkey" FOREIGN KEY ("gce_registration_id") REFERENCES "GceRegistration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GceRegistrationSubject" ADD CONSTRAINT "GceRegistrationSubject_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GceRegistrationPayment" ADD CONSTRAINT "GceRegistrationPayment_gce_registration_id_fkey" FOREIGN KEY ("gce_registration_id") REFERENCES "GceRegistration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GceRegistrationPayment" ADD CONSTRAINT "GceRegistrationPayment_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
