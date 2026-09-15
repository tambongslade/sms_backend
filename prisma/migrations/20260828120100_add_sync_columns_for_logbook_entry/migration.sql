-- Bring LogbookEntry into the sync set.
--
-- Teachers record lessons taught against a SubjectScheme through LogbookEntry
-- rows. With the scheme tree now syncing (20260828120000), the review chain
-- (HOD / VP) is still broken on the peer node until the entries themselves
-- replicate — a teacher writing a logbook on the on-prem server was invisible
-- to a VP viewing the VPS, and vice versa.
--
-- Same watermark warning as prior sync-expansion migrations (see
-- 20260817120000, 20260827120000, 20260827140000, 20260828120000): existing
-- rows land with server_id = NULL. That is deliberate — the null value lets
-- getLocalChanges push them once from whichever node owns them today. Do NOT
-- rewind the sync watermark on the VPS after this ships: rewinding re-runs
-- pullRemoteChanges with peerId attribution over the current NULL rows and
-- stamps them with the VPS's SERVER_ID, at which point the peer's
-- `server_id IS NULL OR server_id = <its own>` filter hides them from every
-- other node.

ALTER TABLE "LogbookEntry"
    ADD COLUMN "server_id" TEXT,
    ADD COLUMN "checksum"  TEXT;

CREATE INDEX "LogbookEntry_server_id_idx" ON "LogbookEntry"("server_id");
