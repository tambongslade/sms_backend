-- Message threading + read receipts for the parent inbox.
--
-- Adds two nullable columns to "Message":
--   * parent_message_id — self-reference used to thread replies. NoAction on
--     delete/update because the existing sync layer already treats Message as
--     append-only and we don't want a cascade to fire during peer replay.
--   * read_at — nullable timestamp set when the receiver marks the message as
--     read. Nullable so all historical rows read as "unread" until touched,
--     which matches the intent of the new inbox UI.

ALTER TABLE "Message"
    ADD COLUMN "parent_message_id" INTEGER,
    ADD COLUMN "read_at"           TIMESTAMP(3);

ALTER TABLE "Message"
    ADD CONSTRAINT "Message_parent_message_id_fkey"
    FOREIGN KEY ("parent_message_id") REFERENCES "Message"("id")
    ON DELETE NO ACTION ON UPDATE NO ACTION;

CREATE INDEX "Message_parent_message_id_idx" ON "Message"("parent_message_id");
CREATE INDEX "Message_receiver_id_read_at_idx" ON "Message"("receiver_id", "read_at");
