-- A RECEIVER node (no REMOTE_SYNC_URL of its own, e.g. the VPS) never runs a
-- sync cycle and so never writes a SyncLog row -- its Data Sync page had
-- nothing real to show even while sync was working correctly. One row per
-- (table_name, sender_server_id), updated in place on every incoming batch
-- rather than appended, so this stays small forever regardless of sync
-- frequency.
CREATE TABLE "SyncReceiptStat" (
    "id" SERIAL NOT NULL,
    "table_name" TEXT NOT NULL,
    "sender_server_id" TEXT NOT NULL,
    "total_records" INTEGER NOT NULL DEFAULT 0,
    "last_received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncReceiptStat_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SyncReceiptStat_table_name_sender_server_id_key" ON "SyncReceiptStat"("table_name", "sender_server_id");

CREATE INDEX "SyncReceiptStat_last_received_at_idx" ON "SyncReceiptStat"("last_received_at");
