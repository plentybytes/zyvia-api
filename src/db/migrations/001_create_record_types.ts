import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('record_types', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('name', 255).notNullable();
    table.text('description').nullable();
    table.boolean('is_active').notNullable().defaultTo(true);
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  // Case-insensitive unique index on name
  await knex.raw('CREATE UNIQUE INDEX record_types_name_lower_idx ON record_types (LOWER(name))');
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('record_types');
}
