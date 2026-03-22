-- Create credit_cards table
CREATE TABLE IF NOT EXISTS credit_cards (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  limit_amount DECIMAL(10, 2) NOT NULL,
  closing_day INT NOT NULL CHECK (closing_day >= 1 AND closing_day <= 31),
  due_day INT NOT NULL CHECK (due_day >= 1 AND due_day <= 31),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY unique_card_per_user (user_id, name)
);

-- Create card_transactions table
CREATE TABLE IF NOT EXISTS card_transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  card_id INT NOT NULL,
  description VARCHAR(255) NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  date DATE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (card_id) REFERENCES credit_cards(id) ON DELETE CASCADE
);

-- Add index to improve query performance
CREATE INDEX idx_card_transactions_card_id ON card_transactions(card_id);
CREATE INDEX idx_card_transactions_date ON card_transactions(date);
CREATE INDEX idx_credit_cards_user_id ON credit_cards(user_id);
