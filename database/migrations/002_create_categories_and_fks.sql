-- 002: categories and transaction/category relationship
CREATE TABLE IF NOT EXISTS categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NULL,
  name VARCHAR(120) NOT NULL,
  type ENUM('income', 'expense') NOT NULL,
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  color VARCHAR(20) NOT NULL DEFAULT '#8A05BE',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY unique_category_per_user_type (user_id, name, type)
);

CREATE INDEX idx_categories_user_id ON categories(user_id);
CREATE INDEX idx_categories_user_type ON categories(user_id, type);
CREATE INDEX idx_categories_default_type ON categories(is_default, type);
CREATE INDEX idx_transactions_category_id ON transactions(category_id);

ALTER TABLE transactions
  ADD CONSTRAINT fk_transactions_category
  FOREIGN KEY (category_id) REFERENCES categories(id);


