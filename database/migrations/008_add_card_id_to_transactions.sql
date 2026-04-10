-- 008: add optional card reference to transactions
ALTER TABLE transactions
  ADD COLUMN card_id INT NULL AFTER payment_method;

CREATE INDEX idx_transactions_card_id ON transactions(card_id);

ALTER TABLE transactions
  ADD CONSTRAINT fk_transactions_card_id
  FOREIGN KEY (card_id) REFERENCES credit_cards(id)
  ON DELETE SET NULL;
