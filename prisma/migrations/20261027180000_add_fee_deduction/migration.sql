-- CreateTable
CREATE TABLE "FeeDeduction" (
    "id" SERIAL NOT NULL,
    "enrollment_id" INTEGER NOT NULL,
    "school_fees_id" INTEGER NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "amount_expected_before" DOUBLE PRECISION NOT NULL,
    "amount_expected_after" DOUBLE PRECISION NOT NULL,
    "is_personnel_child" BOOLEAN NOT NULL DEFAULT false,
    "personnel_id" INTEGER,
    "reason" TEXT,
    "created_by_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "server_id" TEXT,
    "checksum" TEXT,

    CONSTRAINT "FeeDeduction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FeeDeduction_enrollment_id_idx" ON "FeeDeduction"("enrollment_id");
CREATE INDEX "FeeDeduction_school_fees_id_idx" ON "FeeDeduction"("school_fees_id");
CREATE INDEX "FeeDeduction_created_at_idx" ON "FeeDeduction"("created_at");

-- AddForeignKey
ALTER TABLE "FeeDeduction" ADD CONSTRAINT "FeeDeduction_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "Enrollment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FeeDeduction" ADD CONSTRAINT "FeeDeduction_school_fees_id_fkey" FOREIGN KEY ("school_fees_id") REFERENCES "SchoolFees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FeeDeduction" ADD CONSTRAINT "FeeDeduction_personnel_id_fkey" FOREIGN KEY ("personnel_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FeeDeduction" ADD CONSTRAINT "FeeDeduction_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
