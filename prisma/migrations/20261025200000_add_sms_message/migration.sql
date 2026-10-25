-- CreateEnum
CREATE TYPE "SmsStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "SmsMessage" (
    "id" SERIAL NOT NULL,
    "batch_id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "recipient_name" TEXT,
    "user_id" INTEGER,
    "student_id" INTEGER,
    "body" TEXT NOT NULL,
    "segments" INTEGER NOT NULL DEFAULT 1,
    "status" "SmsStatus" NOT NULL DEFAULT 'QUEUED',
    "provider" TEXT NOT NULL DEFAULT 'ORANGE',
    "provider_ref" TEXT,
    "error" TEXT,
    "purpose" TEXT,
    "sent_by" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),

    CONSTRAINT "SmsMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SmsMessage_batch_id_idx" ON "SmsMessage"("batch_id");

-- CreateIndex
CREATE INDEX "SmsMessage_created_at_idx" ON "SmsMessage"("created_at");

-- CreateIndex
CREATE INDEX "SmsMessage_phone_created_at_idx" ON "SmsMessage"("phone", "created_at");
