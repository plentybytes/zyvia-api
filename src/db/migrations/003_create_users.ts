import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('users', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('email', 255).notNullable();
    table.string('password_hash', 255).notNullable();
    table.string('role', 50).notNullable().defaultTo('patient');
    table.string('account_status', 50).notNullable().defaultTo('active');
    table.integer('failed_login_attempts').notNullable().defaultTo(0);
    table.timestamp('locked_until', { useTz: true }).nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  // Case-insensitive unique index on email
  await knex.raw('CREATE UNIQUE INDEX users_email_lower_idx ON users (LOWER(email))');
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('users');
}
