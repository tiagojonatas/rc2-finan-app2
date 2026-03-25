const db = require('./db');

const DEFAULT_EXPENSE_CATEGORIES = [
  { name: 'Moradia', color: '#8B5CF6' },
  { name: 'Alimentacao', color: '#10B981' },
  { name: 'Transporte', color: '#3B82F6' },
  { name: 'Lazer', color: '#F59E0B' },
  { name: 'Saude', color: '#EF4444' },
  { name: 'Educacao', color: '#6366F1' },
  { name: 'Impostos', color: '#EC4899' }
];
const DEFAULT_INCOME_CATEGORIES = [
  { name: 'Salario', color: '#14B8A6' },
  { name: 'Extra', color: '#22C55E' },
  { name: 'Michele', color: '#06B6D4' },
  { name: 'Forex', color: '#F59E0B' }
];

const LEGACY_INCOME_CATEGORY_RENAMES = [
  { from: 'SALARIO', to: 'Salario' },
  { from: 'EXTRA', to: 'Extra' },
  { from: 'MICHELE', to: 'Michele' },
  { from: 'FOREX', to: 'Forex' }
];

async function ensureCategoriesSchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS categories (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      name VARCHAR(120) NOT NULL,
      type ENUM('income', 'expense') NOT NULL,
      color VARCHAR(20) NOT NULL DEFAULT '#8A05BE',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE KEY unique_category_per_user_type (user_id, name, type)
    )
  `);

  try {
    await db.query('CREATE INDEX idx_categories_user_id ON categories(user_id)');
  } catch (error) {
    if (error.code !== 'ER_DUP_KEYNAME') throw error;
  }

  try {
    await db.query('CREATE INDEX idx_categories_user_type ON categories(user_id, type)');
  } catch (error) {
    if (error.code !== 'ER_DUP_KEYNAME') throw error;
  }
}

async function ensureTransactionCategoryColumn() {
  const [columnRows] = await db.query(`
    SELECT COUNT(*) AS count
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'transactions'
      AND COLUMN_NAME = 'category_id'
  `);

  if (!columnRows[0].count) {
    await db.query('ALTER TABLE transactions ADD COLUMN category_id INT NULL');
  }

  try {
    await db.query('CREATE INDEX idx_transactions_category_id ON transactions(category_id)');
  } catch (error) {
    if (error.code !== 'ER_DUP_KEYNAME') throw error;
  }

  const [fkRows] = await db.query(`
    SELECT COUNT(*) AS count
    FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'transactions'
      AND COLUMN_NAME = 'category_id'
      AND REFERENCED_TABLE_NAME = 'categories'
  `);

  if (!fkRows[0].count) {
    await db.query('ALTER TABLE transactions ADD CONSTRAINT fk_transactions_category FOREIGN KEY (category_id) REFERENCES categories(id)');
  }
}

async function seedDefaultCategories() {
  const [users] = await db.query('SELECT id FROM users');

  for (const user of users) {
    for (const category of DEFAULT_EXPENSE_CATEGORIES) {
      await db.query(
        `INSERT INTO categories (user_id, name, type, color)
         VALUES (?, ?, 'expense', ?)
         ON DUPLICATE KEY UPDATE color = VALUES(color)`,
        [user.id, category.name, category.color]
      );
    }

    for (const category of DEFAULT_INCOME_CATEGORIES) {
      await db.query(
        `INSERT INTO categories (user_id, name, type, color)
         VALUES (?, ?, 'income', ?)
         ON DUPLICATE KEY UPDATE color = VALUES(color)`,
        [user.id, category.name, category.color]
      );
    }
  }
}

async function backfillTransactionsCategory() {
  await db.query(`
    UPDATE transactions t
    JOIN categories c ON c.user_id = t.user_id AND c.type = 'expense' AND c.name = 'Moradia'
    SET t.category_id = c.id
    WHERE t.type = 'expense' AND t.category_id IS NULL
  `);

  await db.query(`
    UPDATE transactions t
    JOIN categories c ON c.user_id = t.user_id AND c.type = 'income' AND c.name = 'Salario'
    SET t.category_id = c.id
    WHERE t.type = 'income' AND t.category_id IS NULL
  `);

  const [nullRows] = await db.query('SELECT COUNT(*) AS count FROM transactions WHERE category_id IS NULL');
  if (!nullRows[0].count) {
    await db.query('ALTER TABLE transactions MODIFY category_id INT NOT NULL');
  } else {
    console.warn('Some transactions still have NULL category_id. Please review before enforcing NOT NULL.');
  }
}

async function normalizeLegacyIncomeCategoryNames() {
  for (const rename of LEGACY_INCOME_CATEGORY_RENAMES) {
    const [legacyRows] = await db.query(
      `SELECT id, user_id
       FROM categories
       WHERE type = 'income' AND BINARY name = ?`,
      [rename.from]
    );

    for (const legacy of legacyRows) {
      const [targetRows] = await db.query(
        `SELECT id
         FROM categories
         WHERE user_id = ? AND type = 'income' AND BINARY name = ? AND id <> ?`,
        [legacy.user_id, rename.to, legacy.id]
      );

      if (targetRows.length > 0) {
        const targetId = targetRows[0].id;
        await db.query(
          'UPDATE transactions SET category_id = ? WHERE category_id = ?',
          [targetId, legacy.id]
        );
        await db.query('DELETE FROM categories WHERE id = ?', [legacy.id]);
      } else {
        await db.query('UPDATE categories SET name = ? WHERE id = ?', [rename.to, legacy.id]);
      }
    }
  }
}

async function initCategories() {
  try {
    await ensureCategoriesSchema();
    await ensureTransactionCategoryColumn();
    await normalizeLegacyIncomeCategoryNames();
    await seedDefaultCategories();
    await backfillTransactionsCategory();
    console.log('Categories schema initialized successfully');
  } catch (error) {
    console.error('Error initializing categories schema:', error);
  } finally {
    process.exit(0);
  }
}

initCategories();
