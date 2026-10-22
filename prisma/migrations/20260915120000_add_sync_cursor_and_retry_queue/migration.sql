-- CreateTable
CREATE TABLE "SyncTableCursor" (
    "table_name" TEXT NOT NULL,
    "cursor" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncTableCursor_pkey" PRIMARY KEY ("table_name")
);

-- CreateTable
CREATE TABLE "SyncRetryQueue" (
    "id" SERIAL NOT NULL,
    "table_name" TEXT NOT NULL,
    "record_id" INTEGER NOT NULL,
    "direction" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "last_error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncRetryQueue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SyncRetryQueue_table_name_record_id_direction_key" ON "SyncRetryQueue"("table_name", "record_id", "direction");

-- CreateIndex
CREATE INDEX "SyncRetryQueue_next_attempt_idx" ON "SyncRetryQueue"("next_attempt");
