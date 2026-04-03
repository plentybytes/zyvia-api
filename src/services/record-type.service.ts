import { db } from '../db/connection.js';
import type { RecordType, CreateRecordTypeInput, UpdateRecordTypeInput } from '../models/record-type.js';

export async function listRecordTypes(options: {
  includeInactive: boolean;
}): Promise<RecordType[]> {
  let query = db('record_types').select('*').orderBy('name', 'asc');
  if (!options.includeInactive) {
    query = query.where({ is_active: true });
  }
  return query as Promise<RecordType[]>;
}

export async function createRecordType(input: CreateRecordTypeInput): Promise<RecordType> {
  // Case-insensitive duplicate check
  const existing = await db('record_types')
    .whereRaw('LOWER(name) = LOWER(?)', [input.name])
    .first();

  if (existing) {
    throw Object.assign(
      new Error(`A record type with the name "${input.name}" already exists`),
      { statusCode: 409 },
    );
  }

  const [row] = await db('record_types')
    .insert({
      name: input.name,
      description: input.description ?? null,
    })
    .returning('*');

  return row as RecordType;
}

export async function updateRecordType(
  id: string,
  patch: UpdateRecordTypeInput,
): Promise<RecordType> {
  const existing = await db('record_types').where({ id }).first();
  if (!existing) {
    throw Object.assign(new Error('Record type not found'), { statusCode: 404 });
  }

  // If attempting to hard-delete (is_active = false) and records reference this type,
  // check if there are any records. We only block if caller tries to pass a delete flag.
  // For soft-deprecation (is_active: false), we allow it regardless.
  // The constitution says hard deletion is blocked; PATCH with is_active:false is soft-deprecation.
  const updates: Partial<RecordType> & { updated_at?: Date } = {
    updated_at: new Date(),
  };

  if (patch.description !== undefined) {
    updates.description = patch.description;
  }
  if (patch.is_active !== undefined) {
    updates.is_active = patch.is_active;
  }

  const [updated] = await db('record_types').where({ id }).update(updates).returning('*');
  return updated as RecordType;
}

export async function getRecordTypeById(id: string): Promise<RecordType> {
  const row = await db('record_types').where({ id }).first();
  if (!row) {
    throw Object.assign(new Error('Record type not found'), { statusCode: 404 });
  }
  return row as RecordType;
}
