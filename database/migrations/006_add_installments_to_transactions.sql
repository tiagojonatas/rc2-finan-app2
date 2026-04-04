ALTER TABLE transactions
ADD COLUMN installment_total INT NOT NULL DEFAULT 1 AFTER affects_balance;

ALTER TABLE transactions
ADD COLUMN installment_number INT NOT NULL DEFAULT 1 AFTER installment_total;

ALTER TABLE transactions
ADD COLUMN parent_transaction_id INT NULL AFTER installment_number;

ALTER TABLE transactions
ADD INDEX idx_transactions_parent_transaction_id (parent_transaction_id);

UPDATE transactions
SET installment_total = 1,
    installment_number = 1,
    parent_transaction_id = NULL
WHERE installment_total IS NULL OR installment_number IS NULL;
