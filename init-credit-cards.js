const fs = require('fs');
const path = require('path');
const db = require('./db');

async function initCreditCardsDB() {
  try {
    const schemaPath = path.join(__dirname, 'schema-credit-cards.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');

    await db.query(schema);
    console.log('Credit cards schema initialized successfully');
  } catch (error) {
    console.error('Error executing credit cards schema:', error);
  } finally {
    process.exit(0);
  }
}

initCreditCardsDB();
