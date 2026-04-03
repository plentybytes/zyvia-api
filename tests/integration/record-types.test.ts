/**
 * Integration test: US3 record type management against real PostgreSQL.
 *
 * Requires: docker compose up -d && npm run db:migrate && npm run db:seed
 * Run: npm run test:integration
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../src/db/connection.js';
import * as recordTypeService from '../../src/services/record-type.service.js';
import * as recordService from '../../src/services/record.service.js';
import { Readable } from 'stream';

const UNIQUE_TYPE_NAME = `Integration Test Type ${Date.now()}`;
let newTypeId: string;

afterAll(async () => {
  // Clean up created record type
  if (newTypeId) {
    await db('record_types').where({ id: newTypeId }).delete();
  }
  await db.destroy();
});

describe('Record Type Management Integration', () => {
  it('lists the 8 seeded record types', async () => {
    const types = await recordTypeService.listRecordTypes({ includeInactive: false });
    expect(types.length).toBeGreaterThanOrEqual(8);
    const names = types.map((t) => t.name);
    expect(names).toContain('Lab Result');
    expect(names).toContain('Prescription');
  });

  it('creates a new record type', async () => {
    const created = await recordTypeService.createRecordType({
      name: UNIQUE_TYPE_NAME,
      description: 'Created by integration test',
    });

    expect(created.id).toBeTruthy();
    expect(created.name).toBe(UNIQUE_TYPE_NAME);
    expect(created.is_active).toBe(true);
    newTypeId = created.id;
  });

  it('rejects duplicate record type names (case-insensitive)', async () => {
    await expect(
      recordTypeService.createRecordType({ name: UNIQUE_TYPE_NAME.toLowerCase() }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('allows upload with the new type', async () => {
    const TEST_PATIENT = `integration-type-test-${Date.now()}`;
    const stream = Readable.from(Buffer.from('%PDF-1.4 test'));
    const result = await recordService.createRecord({
      patientId: TEST_PATIENT,
      recordTypeId: newTypeId,
      uploadedByUserId: 'test-provider',
      fileName: 'test.pdf',
      fileSizeBytes: 100,
      mimeType: 'application/pdf',
      fileStream: stream,
    });
    expect(result.id).toBeTruthy();

    // Clean up
    await db('health_records').where({ id: result.id }).delete();
  });

  it('soft-deprecates the type (is_active = false)', async () => {
    const updated = await recordTypeService.updateRecordType(newTypeId, { is_active: false });
    expect(updated.is_active).toBe(false);
  });

  it('rejects upload with deprecated type (409)', async () => {
    const TEST_PATIENT = `integration-type-test-deprecated-${Date.now()}`;
    const stream = Readable.from(Buffer.from('%PDF-1.4 test'));

    await expect(
      recordService.createRecord({
        patientId: TEST_PATIENT,
        recordTypeId: newTypeId,
        uploadedByUserId: 'test-provider',
        fileName: 'test.pdf',
        fileSizeBytes: 100,
        mimeType: 'application/pdf',
        fileStream: stream,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('re-activates the type and allows upload again', async () => {
    const updated = await recordTypeService.updateRecordType(newTypeId, { is_active: true });
    expect(updated.is_active).toBe(true);

    const TEST_PATIENT = `integration-type-test-reactivated-${Date.now()}`;
    const stream = Readable.from(Buffer.from('%PDF-1.4 test'));
    const result = await recordService.createRecord({
      patientId: TEST_PATIENT,
      recordTypeId: newTypeId,
      uploadedByUserId: 'test-provider',
      fileName: 'test.pdf',
      fileSizeBytes: 100,
      mimeType: 'application/pdf',
      fileStream: stream,
    });
    expect(result.id).toBeTruthy();

    await db('health_records').where({ id: result.id }).delete();
  });
});
