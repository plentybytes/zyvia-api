import 'dotenv/config';
import knex from 'knex';
import config from '../src/db/knexfile';

const env = (process.env.NODE_ENV ?? 'development') as keyof typeof config;
const db = knex(config[env]);

const rollback = process.argv[2] === 'rollback';

async function run() {
  if (rollback) {
    const [, files] = await db.migrate.rollback();
    console.log(files.length ? `Rolled back: ${files.join(', ')}` : 'Nothing to roll back');
  } else {
    const [, files] = await db.migrate.latest();
    console.log(files.length ? `Migrated: ${files.join(', ')}` : 'Already up to date');
  }
}

run().finally(() => db.destroy());
