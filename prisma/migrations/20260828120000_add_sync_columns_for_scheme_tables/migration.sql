-- Bring the Scheme of Work tables into the sync set.
--
-- SubjectScheme (owned by VP / Dean of Studies) and its SchemeModule /
-- SchemeChapter / SchemeLesson tree were not synced, so a scheme created on
-- the VPS was invisible to the on-prem node — and any LogbookEntry pulled
-- from a peer would eventually fail on a missing lesson reference once
-- logbook sync ships.
--
-- Same warning as prior sync-expansion migrations (see 20260817120000,
-- 20260827120000, 20260827140000): existing rows land with server_id = NULL.
-- That is deliberate — the null value lets getLocalChanges push them once
-- from whichever node owns them today. Do NOT rewind the sync watermark on
-- the VPS after this ships: rewinding re-runs pullRemoteChanges with peerId
-- attribution over the current NULL rows and stamps them with the VPS's
-- SERVER_ID, at which point the peer's `server_id IS NULL OR server_id =
-- <its own>` filter hides them from every other node. This is the same
-- fault the sync-manager comment records as having hit 6370 production rows
-- once already.

-- ----- SubjectScheme -----
ALTER TABLE "SubjectScheme"
    ADD COLUMN "server_id" TEXT,
    ADD COLUMN "checksum"  TEXT;

-- ----- SchemeModule -----
ALTER TABLE "SchemeModule"
    ADD COLUMN "server_id" TEXT,
    ADD COLUMN "checksum"  TEXT;

-- ----- SchemeChapter -----
ALTER TABLE "SchemeChapter"
    ADD COLUMN "server_id" TEXT,
    ADD COLUMN "checksum"  TEXT;

-- ----- SchemeLesson -----
ALTER TABLE "SchemeLesson"
    ADD COLUMN "server_id" TEXT,
    ADD COLUMN "checksum"  TEXT;

-- ----- Server-id indexes (mirror the pattern from prior sync migrations) -----
CREATE INDEX "SubjectScheme_server_id_idx" ON "SubjectScheme"("server_id");
CREATE INDEX "SchemeModule_server_id_idx"  ON "SchemeModule"("server_id");
CREATE INDEX "SchemeChapter_server_id_idx" ON "SchemeChapter"("server_id");
CREATE INDEX "SchemeLesson_server_id_idx"  ON "SchemeLesson"("server_id");
