-- Extend sync participation to role/assignment tables.
--
-- User is already synced, but the rows that say *which* role a user holds
-- (UserRole), *what they're assigned to* in a given academic year
-- (RoleAssignment), and *which subjects a teacher can teach* (SubjectTeacher)
-- were not. On a peer that meant every synced User arrived without any of
-- their role context, so teachers/HODs/VPs on the remote side had no
-- permissions and no assignments.
--
-- getLocalChanges filters on `server_id` and generateChecksum stores `checksum`,
-- so a model must carry both columns to participate at all.

ALTER TABLE "UserRole"       ADD COLUMN "server_id" TEXT, ADD COLUMN "checksum" TEXT;
ALTER TABLE "RoleAssignment" ADD COLUMN "server_id" TEXT, ADD COLUMN "checksum" TEXT;
ALTER TABLE "SubjectTeacher" ADD COLUMN "server_id" TEXT, ADD COLUMN "checksum" TEXT;

CREATE INDEX "UserRole_server_id_idx"       ON "UserRole"("server_id");
CREATE INDEX "RoleAssignment_server_id_idx" ON "RoleAssignment"("server_id");
CREATE INDEX "SubjectTeacher_server_id_idx" ON "SubjectTeacher"("server_id");
