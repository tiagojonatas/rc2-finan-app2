ALTER TABLE transactions
ADD COLUMN affects_balance TINYINT(1) NOT NULL DEFAULT 1 AFTER is_recurring;

UPDATE transactions
SET affects_balance = 1
WHERE affects_balance IS NULL;
