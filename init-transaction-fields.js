const db = require('./db');

async function ensureColumn(columnName, ddl) {
  const [columnRows] = await db.query(
    `SELECT COUNT(*) AS count
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'transactions'
       AND COLUMN_NAME = ?`,
    [columnName]
  );

  if (!columnRows[0].count) {
    await db.query(ddl);
  }
}

async function initTransactionFields() {
  try {
    await ensureColumn(
      'payment_method',
      "ALTER TABLE transactions ADD COLUMN payment_method ENUM('cash','debit','credit') NOT NULL DEFAULT 'cash'"
    );
    await db.query(
      "ALTER TABLE transactions MODIFY COLUMN payment_method ENUM('cash','pix','credit','debit') NOT NULL DEFAULT 'cash'"
    );
    await ensureColumn(
      'is_recurring',
      'ALTER TABLE transactions ADD COLUMN is_recurring TINYINT(1) NOT NULL DEFAULT 0'
    );
    await ensureColumn(
      'card_id',
      'ALTER TABLE transactions ADD COLUMN card_id INT NULL AFTER payment_method'
    );

    try {
      await db.query('ALTER TABLE transactions ADD INDEX idx_transactions_card_id (card_id)');
    } catch (error) {
      if (error.code !== 'ER_DUP_KEYNAME') throw error;
    }

    try {
      await db.query(
        `ALTER TABLE transactions
         ADD CONSTRAINT fk_transactions_card_id
         FOREIGN KEY (card_id) REFERENCES credit_cards(id) ON DELETE SET NULL`
      );
    } catch (error) {
      if (error.code !== 'ER_FK_DUP_NAME') throw error;
    }

    await db.query(
      "UPDATE transactions SET payment_method = 'cash' WHERE payment_method IS NULL OR payment_method = ''"
    );
    await db.query('UPDATE transactions SET is_recurring = 0 WHERE is_recurring IS NULL');

    console.log('Transaction fields initialized successfully');
  } catch (error) {
    console.error('Error initializing transaction fields:', error);
  } finally {
    process.exit(0);
  }
}

initTransactionFields();
