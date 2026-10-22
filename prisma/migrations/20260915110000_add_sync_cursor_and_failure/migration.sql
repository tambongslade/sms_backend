-- Reconstructed: this migration was applied directly to the VPS database on
-- 2026-09-15 (recorded in its _prisma_migrations under this exact name) as
-- part of the natural-key-first sync fix, but the migration file itself and
-- the schema.prisma model additions were never committed to git, so
-- on-prem never had it. Filed under the same name here so both databases'
-- migration history reconciles: this is a no-op on VPS (already applied)
-- and brings on-prem up to the same schema.
CREATE TABLE "SyncCursor" (
    "table_name" TEXT NOT NULL,
    "cursor" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncCursor_pkey" PRIMARY KEY ("table_name")
);

CREATE TABLE "SyncFailure" (
    "id" SERIAL NOT NULL,
    "table_name" TEXT NOT NULL,
    "record_id" INTEGER NOT NULL,
    "direction" TEXT NOT NULL,
    "strikes" INTEGER NOT NULL DEFAULT 1,
    "last_error" TEXT NOT NULL,
    "first_seen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_attempt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncFailure_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SyncFailure_table_name_record_id_direction_key" ON "SyncFailure"("table_name", "record_id", "direction");

CREATE INDEX "SyncFailure_table_name_strikes_idx" ON "SyncFailure"("table_name", "strikes");
