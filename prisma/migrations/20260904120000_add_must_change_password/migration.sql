-- AlterTable: force-password-change flag for default-password accounts
ALTER TABLE "User" ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT false;
