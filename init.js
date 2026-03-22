const fs = require('fs');
const path = require('path');
const db = require('./db');

async function initDB() {
  try {
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');

    await db.query(schema);
    console.log('Database schema initialized successfully');
  } catch (error) {
    console.error('Error executing schema:', error);
  } finally {
    process.exit(0);
  }
}

initDB();