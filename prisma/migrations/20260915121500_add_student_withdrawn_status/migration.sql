-- Add WITHDRAWN to StudentStatus so student removal becomes a status change
-- (an ordinary field update the sync system already replicates correctly)
-- instead of a hard DELETE, which has no sync counterpart and gets undone
-- by the next pull/push from whichever node still has the row.
ALTER TYPE "StudentStatus" ADD VALUE 'WITHDRAWN';
