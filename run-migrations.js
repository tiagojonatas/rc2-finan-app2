const fs = require('fs');
const path = require('path');
const db = require('./db');

const MIGRATIONS_DIR = path.join(__dirname, 'database', 'migrations');
const IGNORABLE_ERROR_CODES = new Set([
  'ER_TABLE_EXISTS_ERROR',
  'ER_DUP_FIELDNAME',
  'ER_DUP_KEYNAME',
  'ER_DUP_ENTRY',
  'ER_FK_DUP_NAME',
  'ER_CANT_DROP_FIELD_OR_KEY',
  'ER_MULTIPLE_PRI_KEY'
]);

function splitSqlStatements(sqlContent) {
  const lines = sqlContent
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('--'));

  const sql = lines.join('\n');
  const rawStatements = sql.split(';');

  return rawStatements
    .map((stmt) => stmt.trim())
    .filter((stmt) => stmt.length > 0);
}

async function ensureMigrationsTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      file_name VARCHAR(255) NOT NULL UNIQUE,
      executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function getAppliedMigrations() {
  const [rows] = await db.query('SELECT file_name FROM schema_migrations ORDER BY file_name ASC');
  return new Set(rows.map((row) => row.file_name));
}

async function applyMigrationFile(fileName) {
  const fullPath = path.join(MIGRATIONS_DIR, fileName);
  const content = fs.readFileSync(fullPath, 'utf8');
  const statements = splitSqlStatements(content);

  if (!statements.length) {
    console.log(`- ${fileName}: vazio, ignorado`);
    return;
  }

  console.log(`- Aplicando ${fileName}...`);

  for (const statement of statements) {
    try {
      await db.query(statement);
    } catch (error) {
      if (IGNORABLE_ERROR_CODES.has(error.code)) {
        console.log(`  > ignorado (${error.code})`);
        continue;
      }
      throw error;
    }
  }

  await db.query('INSERT INTO schema_migrations (file_name) VALUES (?)', [fileName]);
  console.log(`  > concluido`);
}

async function runMigrations() {
  try {
    await ensureMigrationsTable();

    if (!fs.existsSync(MIGRATIONS_DIR)) {
      console.log('Diretorio de migrations nao encontrado: database/migrations');
      process.exit(0);
      return;
    }

    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((file) => file.toLowerCase().endsWith('.sql'))
      .sort((a, b) => a.localeCompare(b));

    if (!files.length) {
      console.log('Nenhuma migration encontrada.');
      process.exit(0);
      return;
    }

    const applied = await getAppliedMigrations();

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`- ${file}: ja aplicada`);
        continue;
      }
      await applyMigrationFile(file);
    }

    console.log('Migrations finalizadas com sucesso.');
  } catch (error) {
    console.error('Erro ao executar migrations:', error);
    process.exitCode = 1;
  } finally {
    process.exit();
  }
}

runMigrations();
