-- Bring chat + DM tables into the sync set.
--
-- User is already synced, but the actual conversations (Message DMs and the
-- Slack-style ChatChannel / ChatMessage tree) were not, so on the peer the
-- application had users with no chat history and no channel memberships.
--
-- Same warning as previous sync-expansion migrations (see
-- 20260817120000, 20260827120000): existing rows land with
-- server_id = NULL. That is deliberate — the null value lets getLocalChanges
-- push them once from whichever node owns them today. Do NOT rewind the sync
-- watermark on the VPS after this ships: rewinding re-runs pullRemoteChanges
-- with peerId attribution over the current NULL rows and stamps them with the
-- VPS's SERVER_ID, at which point the peer's `server_id IS NULL OR server_id
-- = <its own>` filter hides them from every other node. This is the same fault
-- the sync-manager comment records as having hit 6370 production rows once
-- already; running it again on the 642 chat/role rows would repeat the
-- incident on a smaller table.

-- ----- Message (direct messages) -----
ALTER TABLE "Message"
    ADD COLUMN "server_id" TEXT,
    ADD COLUMN "checksum"  TEXT;

-- ----- ChatChannel -----
ALTER TABLE "ChatChannel"
    ADD COLUMN "server_id" TEXT,
    ADD COLUMN "checksum"  TEXT;

-- ----- ChatChannelMember -----
-- Needs updated_at added: getLocalChanges filters on updated_at, so a table
-- without it can't participate. Backfill existing rows with CURRENT_TIMESTAMP
-- and let Prisma's @updatedAt maintain new writes.
ALTER TABLE "ChatChannelMember"
    ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN "server_id"  TEXT,
    ADD COLUMN "checksum"   TEXT;

-- ----- ChatMessage (channel messages) -----
ALTER TABLE "ChatMessage"
    ADD COLUMN "server_id" TEXT,
    ADD COLUMN "checksum"  TEXT;

-- ----- ChatMessageMention -----
ALTER TABLE "ChatMessageMention"
    ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN "server_id"  TEXT,
    ADD COLUMN "checksum"   TEXT;

-- ----- ChatMessageReaction -----
ALTER TABLE "ChatMessageReaction"
    ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN "server_id"  TEXT,
    ADD COLUMN "checksum"   TEXT;

-- ----- ChatMessageAttachment -----
-- Has neither timestamp today. Both are required by the sync engine.
ALTER TABLE "ChatMessageAttachment"
    ADD COLUMN "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN "server_id"  TEXT,
    ADD COLUMN "checksum"   TEXT;

-- ----- Server-id indexes (mirror the pattern from prior sync migrations) -----
CREATE INDEX "Message_server_id_idx"               ON "Message"("server_id");
CREATE INDEX "ChatChannel_server_id_idx"           ON "ChatChannel"("server_id");
CREATE INDEX "ChatChannelMember_server_id_idx"     ON "ChatChannelMember"("server_id");
CREATE INDEX "ChatMessage_server_id_idx"           ON "ChatMessage"("server_id");
CREATE INDEX "ChatMessageMention_server_id_idx"    ON "ChatMessageMention"("server_id");
CREATE INDEX "ChatMessageReaction_server_id_idx"   ON "ChatMessageReaction"("server_id");
CREATE INDEX "ChatMessageAttachment_server_id_idx" ON "ChatMessageAttachment"("server_id");
