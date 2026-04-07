import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('medical_queries', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.text('query_text').notNullable();
    table.jsonb('health_profile_snapshot').notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('ai_medical_responses', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table
      .uuid('query_id')
      .notNullable()
      .unique()
      .references('id')
      .inTable('medical_queries')
      .onDelete('CASCADE');
    table.text('response_text').notNullable();
    table.text('disclaimer_text').notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('ai_medical_responses');
  await knex.schema.dropTableIfExists('medical_queries');
}
