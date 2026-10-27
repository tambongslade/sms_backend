-- CreateTable
CREATE TABLE "MarkEditGrant" (
    "id" SERIAL NOT NULL,
    "exam_sequence_id" INTEGER NOT NULL,
    "sub_class_subject_id" INTEGER NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "used_at" TIMESTAMP(3),

    CONSTRAINT "MarkEditGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarkEditGrant_exam_sequence_id_sub_class_subject_id_used_at_idx" ON "MarkEditGrant"("exam_sequence_id", "sub_class_subject_id", "used_at");
