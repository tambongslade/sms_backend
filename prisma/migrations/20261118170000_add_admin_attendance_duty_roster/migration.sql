-- CreateEnum
CREATE TYPE "AdminAttendanceStatus" AS ENUM ('PRESENT', 'LATE', 'ABSENT');

-- CreateEnum
CREATE TYPE "DutyRosterSection" AS ENUM ('SATURDAY_CONTROL', 'PREPS_CONTROL', 'COORDINATORS', 'ZONES');

-- CreateTable
CREATE TABLE "AdminAttendanceMember" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "post" TEXT,
    "included" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "server_id" TEXT,
    "checksum" TEXT,

    CONSTRAINT "AdminAttendanceMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAttendance" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "status" "AdminAttendanceStatus" NOT NULL,
    "arrival_time" TEXT,
    "note" TEXT,
    "removed" BOOLEAN NOT NULL DEFAULT false,
    "recorded_by_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "server_id" TEXT,
    "checksum" TEXT,

    CONSTRAINT "AdminAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DutyRosterEntry" (
    "id" SERIAL NOT NULL,
    "month" TEXT NOT NULL,
    "section" "DutyRosterSection" NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "week" INTEGER,
    "date" TIMESTAMP(3),
    "time_label" TEXT,
    "zone" TEXT,
    "position" TEXT,
    "class_label" TEXT,
    "activity" TEXT,
    "assignee_ids" TEXT,
    "assignee_note" TEXT,
    "removed" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "server_id" TEXT,
    "checksum" TEXT,

    CONSTRAINT "DutyRosterEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdminAttendanceMember_user_id_key" ON "AdminAttendanceMember"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "AdminAttendance_user_id_date_key" ON "AdminAttendance"("user_id", "date");

-- CreateIndex
CREATE INDEX "AdminAttendance_date_idx" ON "AdminAttendance"("date");

-- CreateIndex
CREATE INDEX "DutyRosterEntry_month_section_idx" ON "DutyRosterEntry"("month", "section");

-- AddForeignKey
ALTER TABLE "AdminAttendanceMember" ADD CONSTRAINT "AdminAttendanceMember_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminAttendance" ADD CONSTRAINT "AdminAttendance_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminAttendance" ADD CONSTRAINT "AdminAttendance_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DutyRosterEntry" ADD CONSTRAINT "DutyRosterEntry_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
