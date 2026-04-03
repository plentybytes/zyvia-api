/**
 * Integration test: full US1→US2 flow against real PostgreSQL + MinIO.
 *
 * Requires: docker compose up -d
 * Run: npm run test:integration
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../src/db/connection.js';
import * as recordService from '../../src/services/record.service.js';
import { Readable } from 'stream';

const TEST_PATIENT_ID = `integration-test-patient-${Date.now()}`;
const TEST_USER_ID = 'integration-test-provider';

let createdRecordId: string;
let labResultTypeId: string;

beforeAll(async () => {
  // Get Lab Result type ID
  const labType = await db('record_types').where({ name: 'Lab Result' }).first();
  if (!labType) throw new Error('Record types not seeded. Run: npm run db:seed');
  labResultTypeId = labType.id as string;
});

afterAll(async () => {
  // Clean up test records
  await db('health_records').where({ patient_id: TEST_PATIENT_ID }).delete();
  await db.destroy();
});

describe('Upload and Retrieve Integration', () => {
  it('uploads a health record and returns a record ID', async () => {
    const pdfContent = Buffer.from('%PDF-1.4 integration-test-content');
    const stream = Readable.from(pdfContent);

    const result = await recordService.createRecord({
      patientId: TEST_PATIENT_ID,
      recordTypeId: labResultTypeId,
      uploadedByUserId: TEST_USER_ID,
      fileName: 'integration-test.pdf',
      fileSizeBytes: pdfContent.length,
      mimeType: 'application/pdf',
      fileStream: stream,
    });

    expect(result.id).toBeTruthy();
    expect(result.isIdempotentDuplicate).toBe(false);
    createdRecordId = result.id;
  });

  it('lists records for the test patient and finds the uploaded record', async () => {
    const result = await recordService.listRecords({
      patientId: TEST_PATIENT_ID,
      limit: 10,
    });

    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe(createdRecordId);
    expect(result.data[0].file_name).toBe('integration-test.pdf');
    expect(result.has_more).toBe(false);
  });

  it('retrieves a single record by ID with a pre-signed download URL', async () => {
    const record = await recordService.getRecordById(createdRecordId, TEST_PATIENT_ID);

    expect(record.id).toBe(createdRecordId);
    expect(record.download_url).toContain('http');
    expect(record.download_url_expires_at.getTime()).toBeGreaterThan(Date.now());
  });

  it('returns empty list when patient has no records', async () => {
    const result = await recordService.listRecords({
      patientId: 'no-records-patient',
      limit: 10,
    });

    expect(result.data).toHaveLength(0);
    expect(result.has_more).toBe(false);
  });
});
