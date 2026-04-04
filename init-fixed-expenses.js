const db = require('./db');

async function ensureIndex(sql, duplicateCode = 'ER_DUP_KEYNAME') {
  try {
    await db.query(sql);
  } catch (error) {
    if (error.code !== duplicateCode) throw error;
  }
}

async function ensureColumn(sql) {
  try {
    await db.query(sql);
  } catch (error) {
    if (error.code !== 'ER_DUP_FIELDNAME') throw error;
  }
}

async function initFixedExpensesDB() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS fixed_expenses (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        description VARCHAR(255) NOT NULL,
        amount DECIMAL(10, 2) NULL,
        category_id INT NULL,
        due_day INT NOT NULL CHECK (due_day >= 1 AND due_day <= 31),
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    await db.query(`ALTER TABLE fixed_expenses MODIFY amount DECIMAL(10, 2) NULL`);
    await ensureColumn(`ALTER TABLE fixed_expenses ADD COLUMN value_type ENUM('fixed', 'variable') NOT NULL DEFAULT 'fixed' AFTER amount`);
    await db.query(`
      UPDATE fixed_expenses
      SET value_type = CASE
        WHEN amount IS NULL THEN 'variable'
        ELSE 'fixed'
      END
      WHERE value_type IS NULL OR value_type = ''
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS monthly_fixed_expenses (
        id INT AUTO_INCREMENT PRIMARY KEY,
        fixed_expense_id INT NOT NULL,
        user_id INT NOT NULL,
        month TINYINT NOT NULL,
        year SMALLINT NOT NULL,
        amount DECIMAL(10, 2) NOT NULL,
        due_date DATE NOT NULL,
        status ENUM('pendente', 'pago', 'atrasado') NOT NULL DEFAULT 'pendente',
        payment_date DATE NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_monthly_fixed_expenses_fixed
          FOREIGN KEY (fixed_expense_id) REFERENCES fixed_expenses(id) ON DELETE CASCADE,
        CONSTRAINT fk_monthly_fixed_expenses_user
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT uq_monthly_fixed_expense UNIQUE (fixed_expense_id, month, year)
      )
    `);

    await ensureIndex('CREATE INDEX idx_fixed_expenses_user_id ON fixed_expenses(user_id)');
    await ensureIndex('CREATE INDEX idx_fixed_expenses_user_active ON fixed_expenses(user_id, is_active)');
    await ensureIndex('CREATE INDEX idx_monthly_fixed_expenses_user_month ON monthly_fixed_expenses(user_id, year, month)');
    await ensureIndex('CREATE INDEX idx_monthly_fixed_expenses_status ON monthly_fixed_expenses(user_id, status)');

    console.log('Fixed expenses + monthly occurrences schema initialized successfully');
  } catch (error) {
    console.error('Error executing fixed expenses schema:', error);
  } finally {
    process.exit(0);
  }
}

initFixedExpensesDB();
