import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('health_records', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('patient_id', 255).notNullable();
    table
      .uuid('record_type_id')
      .notNullable()
      .references('id')
      .inTable('record_types')
      .onDelete('RESTRICT');
    table.string('uploaded_by_user_id', 255).notNullable();
    table.string('file_name', 512).notNullable();
    table.bigInteger('file_size_bytes').notNullable();
    table.string('mime_type', 128).notNullable();
    table.string('storage_key', 1024).notNullable().unique();
    table.string('idempotency_key', 255).nullable();
    table.timestamp('idempotency_key_expires_at', { useTz: true }).nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('deleted_at', { useTz: true }).nullable();
  });

  // Partial unique index on idempotency_key (only when not null)
  await knex.raw(
    'CREATE UNIQUE INDEX health_records_idempotency_key_idx ON health_records (idempotency_key) WHERE idempotency_key IS NOT NULL',
  );

  // Composite indexes for list queries
  await knex.raw(
    'CREATE INDEX health_records_patient_created_idx ON health_records (patient_id, created_at DESC, id DESC) WHERE deleted_at IS NULL',
  );
  await knex.raw(
    'CREATE INDEX health_records_patient_type_created_idx ON health_records (patient_id, record_type_id, created_at DESC, id DESC) WHERE deleted_at IS NULL',
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('health_records');
}
