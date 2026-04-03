import 'dotenv/config';
import knex from 'knex';
import config from '../src/db/knexfile';

const env = (process.env.NODE_ENV ?? 'development') as keyof typeof config;
const db = knex(config[env]);

async function run() {
  const executed = await db.seed.run();
  console.log(executed);
  console.log(executed.length ? `Seeded: ${executed.join(', ')}` : 'No seed files found');
}

run().finally(() => db.destroy());
