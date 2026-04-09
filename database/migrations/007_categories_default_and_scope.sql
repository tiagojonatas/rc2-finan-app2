-- 007: support global default categories and per-user isolation
ALTER TABLE categories MODIFY user_id INT NULL;

ALTER TABLE categories
  ADD COLUMN is_default TINYINT(1) NOT NULL DEFAULT 0 AFTER type;

UPDATE categories
SET is_default = COALESCE(is_default, 0);

CREATE INDEX idx_categories_default_type ON categories(is_default, type);
