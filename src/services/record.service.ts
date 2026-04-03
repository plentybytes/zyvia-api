import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/connection.js';
import * as storageService from './storage.service.js';
import {
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE_BYTES,
  encodeCursor,
  decodeCursor,
  type CreateRecordInput,
  type HealthRecordSummary,
  type HealthRecordDetail,
  type ListRecordsInput,
  type ListRecordsResult,
  type MimeType,
} from '../models/health-record.js';
import type { RecordType } from '../models/record-type.js';

const DOWNLOAD_LINK_TTL_SECONDS = 24 * 60 * 60; // 24 hours
const IDEMPOTENCY_KEY_TTL_SECONDS = 24 * 60 * 60;

export async function createRecord(input: CreateRecordInput): Promise<{ id: string; created_at: Date; isIdempotentDuplicate: boolean }> {
  const {
    patientId,
    recordTypeId,
    uploadedByUserId,
    fileName,
    fileSizeBytes,
    mimeType,
    fileStream,
    idempotencyKey,
  } = input;

  // Validate MIME type
  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    const err = new Error(`Unsupported file type: ${mimeType}. Allowed: ${ALLOWED_MIME_TYPES.join(', ')}`);
    (err as NodeJS.ErrnoException).code = 'UNSUPPORTED_MIME_TYPE';
    throw Object.assign(err, { statusCode: 422 });
  }

  // Validate file size
  if (fileSizeBytes > MAX_FILE_SIZE_BYTES) {
    const err = new Error(`File size ${fileSizeBytes} bytes exceeds 50 MB limit`);
    throw Object.assign(err, { statusCode: 413 });
  }

  // Check idempotency key — return existing record if already processed
  if (idempotencyKey) {
    const existing = await db('health_records')
      .where({ idempotency_key: idempotencyKey })
      .whereNull('deleted_at')
      .where('idempotency_key_expires_at', '>', db.fn.now())
      .first();

    if (existing) {
      return { id: existing.id as string, created_at: existing.created_at as Date, isIdempotentDuplicate: true };
    }
  }

  // Validate record type exists and is active
  const recordType = await db('record_types').where({ id: recordTypeId }).first();
  if (!recordType) {
    throw Object.assign(new Error(`Record type ${recordTypeId} not found`), { statusCode: 404 });
  }
  if (!recordType.is_active) {
    throw Object.assign(
      new Error(`Record type "${recordType.name as string}" is inactive and cannot be used`),
      { statusCode: 409 },
    );
  }

  const recordId = uuidv4();
  const storageKey = storageService.buildStorageKey(patientId, recordId, fileName);

  // Upload file to object store
  await storageService.uploadFile(storageKey, fileStream, mimeType);

  // Persist metadata
  const idempotencyExpiresAt = idempotencyKey
    ? new Date(Date.now() + IDEMPOTENCY_KEY_TTL_SECONDS * 1000)
    : null;

  const [row] = await db('health_records')
    .insert({
      id: recordId,
      patient_id: patientId,
      record_type_id: recordTypeId,
      uploaded_by_user_id: uploadedByUserId,
      file_name: fileName,
      file_size_bytes: fileSizeBytes,
      mime_type: mimeType,
      storage_key: storageKey,
      idempotency_key: idempotencyKey ?? null,
      idempotency_key_expires_at: idempotencyExpiresAt,
    })
    .returning(['id', 'created_at']);

  return { id: row.id as string, created_at: row.created_at as Date, isIdempotentDuplicate: false };
}

export async function listRecords(input: ListRecordsInput): Promise<ListRecordsResult> {
  const { patientId, recordTypeId, cursor, limit } = input;

  let query = db('health_records as hr')
    .join('record_types as rt', 'hr.record_type_id', 'rt.id')
    .where('hr.patient_id', patientId)
    .whereNull('hr.deleted_at')
    .select(
      'hr.id',
      'hr.patient_id',
      'hr.file_name',
      'hr.file_size_bytes',
      'hr.mime_type',
      'hr.created_at',
      'rt.id as rt_id',
      'rt.name as rt_name',
      'rt.description as rt_description',
      'rt.is_active as rt_is_active',
      'rt.created_at as rt_created_at',
    )
    .orderBy('hr.created_at', 'desc')
    .orderBy('hr.id', 'desc')
    .limit(limit + 1); // Fetch one extra to detect has_more

  if (recordTypeId) {
    query = query.where('hr.record_type_id', recordTypeId);
  }

  if (cursor) {
    const decoded = decodeCursor(cursor);
    query = query.where(function () {
      this.where('hr.created_at', '<', decoded.created_at).orWhere(function () {
        this.where('hr.created_at', '=', decoded.created_at).andWhere('hr.id', '<', decoded.id);
      });
    });
  }

  const rows = await query;
  const has_more = rows.length > limit;
  const pageRows = has_more ? rows.slice(0, limit) : rows;

  const data: HealthRecordSummary[] = pageRows.map((row) => ({
    id: row.id as string,
    patient_id: row.patient_id as string,
    record_type: {
      id: row.rt_id as string,
      name: row.rt_name as string,
      description: row.rt_description as string | null,
      is_active: row.rt_is_active as boolean,
      created_at: row.rt_created_at as Date,
      updated_at: row.rt_created_at as Date,
    } satisfies RecordType,
    file_name: row.file_name as string,
    file_size_bytes: Number(row.file_size_bytes),
    mime_type: row.mime_type as MimeType,
    created_at: row.created_at as Date,
  }));

  const lastRow = pageRows[pageRows.length - 1];
  const next_cursor =
    has_more && lastRow
      ? encodeCursor({
          created_at: (lastRow.created_at as Date).toISOString(),
          id: lastRow.id as string,
        })
      : null;

  return { data, next_cursor, has_more };
}

export async function getRecordById(
  id: string,
  patientId: string,
): Promise<HealthRecordDetail> {
  const row = await db('health_records as hr')
    .join('record_types as rt', 'hr.record_type_id', 'rt.id')
    .where('hr.id', id)
    .whereNull('hr.deleted_at')
    .select(
      'hr.id',
      'hr.patient_id',
      'hr.storage_key',
      'hr.file_name',
      'hr.file_size_bytes',
      'hr.mime_type',
      'hr.created_at',
      'rt.id as rt_id',
      'rt.name as rt_name',
      'rt.description as rt_description',
      'rt.is_active as rt_is_active',
      'rt.created_at as rt_created_at',
    )
    .first();

  if (!row) {
    throw Object.assign(new Error('Record not found'), { statusCode: 404 });
  }

  if (row.patient_id !== patientId) {
    throw Object.assign(new Error('Record not found'), { statusCode: 404 });
  }

  const downloadUrl = await storageService.generatePresignedUrl(
    row.storage_key as string,
    DOWNLOAD_LINK_TTL_SECONDS,
  );
  const downloadUrlExpiresAt = new Date(Date.now() + DOWNLOAD_LINK_TTL_SECONDS * 1000);

  return {
    id: row.id as string,
    patient_id: row.patient_id as string,
    record_type: {
      id: row.rt_id as string,
      name: row.rt_name as string,
      description: row.rt_description as string | null,
      is_active: row.rt_is_active as boolean,
      created_at: row.rt_created_at as Date,
      updated_at: row.rt_created_at as Date,
    },
    file_name: row.file_name as string,
    file_size_bytes: Number(row.file_size_bytes),
    mime_type: row.mime_type as MimeType,
    created_at: row.created_at as Date,
    download_url: downloadUrl,
    download_url_expires_at: downloadUrlExpiresAt,
  };
}
