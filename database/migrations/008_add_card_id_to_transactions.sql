ALTER TABLE transactions
  ADD COLUMN card_id INT NULL AFTER payment_method;

ALTER TABLE transactions
  MODIFY COLUMN payment_method ENUM('cash','pix','credit','debit') NOT NULL DEFAULT 'cash';

ALTER TABLE transactions
  ADD INDEX idx_transactions_card_id (card_id);

ALTER TABLE transactions
  ADD CONSTRAINT fk_transactions_card_id
  FOREIGN KEY (card_id) REFERENCES credit_cards(id) ON DELETE SET NULL;
