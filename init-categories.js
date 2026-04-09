const db = require('./db');
const { getDefaultCategoryCatalog } = require('./utils/default-categories');

const DEFAULT_CATEGORIES = getDefaultCategoryCatalog();

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
      user_id INT NULL,
      name VARCHAR(120) NOT NULL,
      type ENUM('income', 'expense') NOT NULL,
      is_default TINYINT(1) NOT NULL DEFAULT 0,
      color VARCHAR(20) NOT NULL DEFAULT '#8A05BE',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE KEY unique_category_per_user_type (user_id, name, type)
    )
  `);

  try {
    await db.query('ALTER TABLE categories MODIFY user_id INT NULL');
  } catch (error) {
    if (error.code !== 'ER_INVALID_USE_OF_NULL') throw error;
  }

  try {
    await db.query('ALTER TABLE categories ADD COLUMN is_default TINYINT(1) NOT NULL DEFAULT 0 AFTER type');
  } catch (error) {
    if (error.code !== 'ER_DUP_FIELDNAME') throw error;
  }

  await db.query('UPDATE categories SET is_default = 0 WHERE is_default IS NULL');

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

  try {
    await db.query('CREATE INDEX idx_categories_default_type ON categories(is_default, type)');
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
  for (const category of DEFAULT_CATEGORIES.expense) {
    const [existingRows] = await db.query(
      `SELECT id
       FROM categories
       WHERE is_default = 1
         AND type = 'expense'
         AND LOWER(TRIM(name)) = LOWER(TRIM(?))
       LIMIT 1`,
      [category.name]
    );

    if (existingRows.length) {
      await db.query('UPDATE categories SET color = ?, user_id = NULL, is_default = 1 WHERE id = ?', [category.color, existingRows[0].id]);
      continue;
    }

    await db.query(
      `INSERT INTO categories (user_id, name, type, is_default, color)
       VALUES (NULL, ?, 'expense', 1, ?)`,
      [category.name, category.color]
    );
  }

  for (const category of DEFAULT_CATEGORIES.income) {
    const [existingRows] = await db.query(
      `SELECT id
       FROM categories
       WHERE is_default = 1
         AND type = 'income'
         AND LOWER(TRIM(name)) = LOWER(TRIM(?))
       LIMIT 1`,
      [category.name]
    );

    if (existingRows.length) {
      await db.query('UPDATE categories SET color = ?, user_id = NULL, is_default = 1 WHERE id = ?', [category.color, existingRows[0].id]);
      continue;
    }

    await db.query(
      `INSERT INTO categories (user_id, name, type, is_default, color)
       VALUES (NULL, ?, 'income', 1, ?)`,
      [category.name, category.color]
    );
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
