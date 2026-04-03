import type { Knex } from 'knex';
import 'dotenv/config';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL environment variable is required');
}

const config: Record<string, Knex.Config> = {
  development: {
    client: 'pg',
    connection: databaseUrl,
    migrations: {
      directory: './src/db/migrations',
      extension: 'ts',
    },
    seeds: {
      directory: './src/db/seeds',
      extension: 'ts',
    },
  },
  test: {
    client: 'pg',
    connection: process.env.TEST_DATABASE_URL ?? databaseUrl,
    migrations: {
      directory: './src/db/migrations',
      extension: 'ts',
    },
    seeds: {
      directory: './src/db/seeds',
      extension: 'ts',
    },
  },
  production: {
    client: 'pg',
    connection: {
      connectionString: databaseUrl,
      ssl: { rejectUnauthorized: false },
    },
    pool: { min: 2, max: 10 },
    migrations: {
      directory: './src/db/migrations',
      extension: 'ts',
    },
  },
};

export default config;
module.exports = config;
