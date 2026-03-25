const db = require('./db');

async function initUserRoles() {
  try {
    const [columnRows] = await db.query(`
      SELECT COUNT(*) AS count
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'users'
        AND COLUMN_NAME = 'role'
    `);

    if (!columnRows[0].count) {
      await db.query(
        "ALTER TABLE users ADD COLUMN role ENUM('user','admin') NOT NULL DEFAULT 'user'"
      );
    }

    await db.query("UPDATE users SET role = 'user' WHERE role IS NULL OR role = ''");
    console.log('User roles initialized successfully');
  } catch (error) {
    console.error('Error initializing user roles:', error);
  } finally {
    process.exit(0);
  }
}

initUserRoles();
