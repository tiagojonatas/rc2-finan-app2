ALTER TABLE fixed_expenses
  ADD COLUMN value_type ENUM('fixed', 'variable') NOT NULL DEFAULT 'fixed' AFTER amount;

UPDATE fixed_expenses
SET value_type = CASE
  WHEN amount IS NULL THEN 'variable'
  ELSE 'fixed'
END;
