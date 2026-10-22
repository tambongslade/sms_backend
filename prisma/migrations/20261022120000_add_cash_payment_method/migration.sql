-- Merge of the online server's work: the online database already has CASH in PaymentMethod.
-- Additive and idempotent (IF NOT EXISTS).
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'CASH';
