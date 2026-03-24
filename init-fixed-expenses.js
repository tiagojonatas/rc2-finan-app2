const db = require('./db');

async function initFixedExpensesDB() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS fixed_expenses (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        description VARCHAR(255) NOT NULL,
        amount DECIMAL(10, 2) NOT NULL,
        category_id INT NULL,
        due_day INT NOT NULL CHECK (due_day >= 1 AND due_day <= 31),
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    try {
      await db.query('CREATE INDEX idx_fixed_expenses_user_id ON fixed_expenses(user_id)');
    } catch (error) {
      if (error.code !== 'ER_DUP_KEYNAME') throw error;
    }

    try {
      await db.query('CREATE INDEX idx_fixed_expenses_user_active ON fixed_expenses(user_id, is_active)');
    } catch (error) {
      if (error.code !== 'ER_DUP_KEYNAME') throw error;
    }

    console.log('Fixed expenses schema initialized successfully');
  } catch (error) {
    console.error('Error executing fixed expenses schema:', error);
  } finally {
    process.exit(0);
  }
}

initFixedExpensesDB();
