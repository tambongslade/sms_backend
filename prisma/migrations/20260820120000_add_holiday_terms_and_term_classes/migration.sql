-- Holiday term support: flag a Term as a holiday period and (via TermClass)
-- restrict which classes it applies to. Existing terms keep is_holiday = FALSE
-- and no TermClass rows, so nothing changes for the current teaching terms.

-- ----- Term column -----
ALTER TABLE "Term"
    ADD COLUMN "is_holiday" BOOLEAN NOT NULL DEFAULT FALSE;

-- ----- TermClass join table -----
CREATE TABLE "TermClass" (
    "id"         SERIAL PRIMARY KEY,
    "term_id"    INTEGER NOT NULL,
    "class_id"   INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "server_id"  TEXT,
    "checksum"   TEXT,
    CONSTRAINT "TermClass_term_id_fkey"
        FOREIGN KEY ("term_id") REFERENCES "Term"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TermClass_class_id_fkey"
        FOREIGN KEY ("class_id") REFERENCES "Class"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "TermClass_term_id_class_id_key"
    ON "TermClass"("term_id", "class_id");
CREATE INDEX "TermClass_class_id_idx"
    ON "TermClass"("class_id");
