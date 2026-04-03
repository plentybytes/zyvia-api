/**
 * Integration test: idempotency key behaviour.
 *
 * Requires: docker compose up -d && npm run db:migrate && npm run db:seed
 */
import { describe, it, expect, afterAll } from 'vitest';
import { db } from '../../src/db/connection.js';
import * as recordService from '../../src/services/record.service.js';
import { Readable } from 'stream';

const TEST_PATIENT = `idempotency-test-${Date.now()}`;
let labResultTypeId: string;

async function getLabResultTypeId(): Promise<string> {
  if (!labResultTypeId) {
    const t = await db('record_types').where({ name: 'Lab Result' }).first();
    if (!t) throw new Error('Seed data missing');
    labResultTypeId = t.id as string;
  }
  return labResultTypeId;
}

afterAll(async () => {
  await db('health_records').where({ patient_id: TEST_PATIENT }).delete();
  await db.destroy();
});

describe('Idempotency Key Behaviour', () => {
  it('returns the same record ID on a retried upload with the same key', async () => {
    const typeId = await getLabResultTypeId();
    const key = `idem-key-${Date.now()}`;

    const first = await recordService.createRecord({
      patientId: TEST_PATIENT,
      recordTypeId: typeId,
      uploadedByUserId: 'provider-001',
      fileName: 'first.pdf',
      fileSizeBytes: 100,
      mimeType: 'application/pdf',
      fileStream: Readable.from(Buffer.from('%PDF-1.4')),
      idempotencyKey: key,
    });

    const second = await recordService.createRecord({
      patientId: TEST_PATIENT,
      recordTypeId: typeId,
      uploadedByUserId: 'provider-001',
      fileName: 'retry.pdf',
      fileSizeBytes: 100,
      mimeType: 'application/pdf',
      fileStream: Readable.from(Buffer.from('%PDF-1.4')),
      idempotencyKey: key,
    });

    expect(second.id).toBe(first.id);
    expect(second.isIdempotentDuplicate).toBe(true);

    // Verify only one row in DB
    const rows = await db('health_records').where({ patient_id: TEST_PATIENT, idempotency_key: key });
    expect(rows.length).toBe(1);
  });

  it('creates a new record when no idempotency key is provided', async () => {
    const typeId = await getLabResultTypeId();

    const first = await recordService.createRecord({
      patientId: TEST_PATIENT,
      recordTypeId: typeId,
      uploadedByUserId: 'provider-001',
      fileName: 'no-key-1.pdf',
      fileSizeBytes: 100,
      mimeType: 'application/pdf',
      fileStream: Readable.from(Buffer.from('%PDF-1.4')),
    });

    const second = await recordService.createRecord({
      patientId: TEST_PATIENT,
      recordTypeId: typeId,
      uploadedByUserId: 'provider-001',
      fileName: 'no-key-2.pdf',
      fileSizeBytes: 100,
      mimeType: 'application/pdf',
      fileStream: Readable.from(Buffer.from('%PDF-1.4')),
    });

    expect(second.id).not.toBe(first.id);
    expect(second.isIdempotentDuplicate).toBe(false);
  });
});
