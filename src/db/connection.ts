import knex from 'knex';
import knexConfig from './knexfile.js';

const env = (process.env.NODE_ENV as 'development' | 'test' | 'production') ?? 'development';

export const db = knex(knexConfig[env]);
