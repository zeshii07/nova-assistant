#!/usr/bin/env node
/**
 * Nova Database Migration Runner (v22.0)
 *
 * Applies SQL migration files from database/migrations/ to PostgreSQL.
 * Tracks applied migrations in the nova_schema_migrations table.
 *
 * Usage:
 *   npm run db:migrate              # Apply all pending migrations
 *   node scripts/migrate.js          # Same as above
 *   node scripts/migrate.js --status # Show migration status
 *
 * Requirements:
 *   - DATABASE_URL must be set in .env or environment
 *   - PostgreSQL must be running and accessible
 *
 * Migration files must be named: NNN_description.sql (e.g., 001_v7_core.sql)
 * They are applied in sorted (alphabetical) order.
 * Each file should use CREATE TABLE IF NOT EXISTS and ON CONFLICT DO NOTHING
 * for idempotency. The migrator also wraps each file in a transaction.
 */

const fs = require('fs');
const path = require('path');
const { loadConfig } = require('../packages/config/src/config');
const { PostgresClient } = require('../packages/storage/src/postgresClient');

const MIGRATIONS_DIR = path.resolve(__dirname, '../database/migrations');
const STATUS_ONLY = process.argv.includes('--status');

async function ensureMigrationsTable(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS nova_schema_migrations (
      version text PRIMARY KEY,
      filename text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

async function getAppliedMigrations(db) {
  const result = await db.query('SELECT version, filename, applied_at FROM nova_schema_migrations ORDER BY version');
  return new Map(result.rows.map(row => [row.version, row]));
}

async function getPendingMigrations(db) {
  await ensureMigrationsTable(db);
  const applied = await getAppliedMigrations(db);

  if (!fs.existsSync(MIGRATIONS_DIR)) {
    return [];
  }

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(name => name.endsWith('.sql'))
    .sort();

  return files
    .map(filename => {
      // Extract version from filename: "001_v7_core.sql" → "001"
      const match = filename.match(/^(\d+)/);
      const version = match ? match[1] : filename.replace('.sql', '');
      return { filename, version, path: path.join(MIGRATIONS_DIR, filename) };
    })
    .filter(migration => !applied.has(migration.version));
}

async function applyMigration(db, migration) {
  const sql = fs.readFileSync(migration.path, 'utf8');
  console.log(`  Applying ${migration.filename}...`);

  await db.transaction(async (client) => {
    await client.query(sql);
    await client.query(
      'INSERT INTO nova_schema_migrations (version, filename) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [migration.version, migration.filename]
    );
  });

  console.log(`  ✓ Applied ${migration.filename}`);
}

async function showStatus(db) {
  const applied = await getAppliedMigrations(db);
  const pending = await getPendingMigrations(db);

  console.log('\n=== Nova Database Migration Status ===\n');

  if (applied.size > 0) {
    console.log('Applied migrations:');
    for (const [version, row] of applied) {
      console.log(`  ✓ ${version} — ${row.filename} (applied ${row.applied_at.toISOString()})`);
    }
  } else {
    console.log('Applied migrations: none');
  }

  console.log('');

  if (pending.length > 0) {
    console.log('Pending migrations:');
    for (const m of pending) {
      console.log(`  ⏳ ${m.version} — ${m.filename}`);
    }
  } else {
    console.log('Pending migrations: none (database is up to date)');
  }

  console.log(`\nTotal: ${applied.size} applied, ${pending.length} pending\n`);
}

async function main() {
  const config = loadConfig();

  if (!config.databaseUrl) {
    console.error('ERROR: DATABASE_URL is required. Set it in your .env file.');
    console.error('Example: DATABASE_URL=postgresql://nova:nova@localhost:5432/nova');
    process.exitCode = 1;
    return;
  }

  console.log(`\nConnecting to PostgreSQL...`);
  console.log(`  URL: ${config.databaseUrl.replace(/:[^:@]+@/, ':***@')}`);

  const db = new PostgresClient({ connectionString: config.databaseUrl, logger: null });

  try {
    await db.connect();
    console.log('  ✓ Connected\n');

    if (STATUS_ONLY) {
      await showStatus(db);
      return;
    }

    const pending = await getPendingMigrations(db);

    if (pending.length === 0) {
      console.log('✓ Database is up to date. No migrations to apply.\n');
      await showStatus(db);
      return;
    }

    console.log(`Applying ${pending.length} migration(s)...\n`);

    for (const migration of pending) {
      await applyMigration(db, migration);
    }

    console.log(`\n✓ All ${pending.length} migration(s) applied successfully.\n`);
    await showStatus(db);

  } catch (error) {
    console.error(`\n✗ Migration failed: ${error.message}\n`);
    if (error.stack) {
      console.error(error.stack.split('\n').slice(0, 5).join('\n'));
    }
    process.exitCode = 1;
  } finally {
    await db.close();
  }
}

main().catch(error => {
  console.error('Fatal error:', error.message);
  process.exitCode = 1;
});
