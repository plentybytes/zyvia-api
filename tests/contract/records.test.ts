/**
 * Contract tests for POST /v1/upload, GET /v1/records, GET /v1/records/:id
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';

vi.mock('../../src/config/index.js', async () => {
  const { TEST_CONFIG } = await import('../fixtures/test-keys.js');
  return { config: TEST_CONFIG };
});

const MOCK_RECORD_TYPE = {
  id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  name: 'Lab Result',
  description: 'Lab test results',
  is_active: true,
  created_at: new Date('2026-04-01T00:00:00Z'),
  updated_at: new Date('2026-04-01T00:00:00Z'),
};

const MOCK_RECORD = {
  id: '00000000-0001-0000-0000-000000000001',
  patient_id: 'patient-abc-123',
  record_type: MOCK_RECORD_TYPE,
  file_name: 'blood-test.pdf',
  file_size_bytes: 204800,
  mime_type: 'application/pdf',
  created_at: new Date('2026-04-02T10:00:00Z'),
};

vi.mock('../../src/services/record.service.js', () => ({
  createRecord: vi.fn().mockResolvedValue({
    id: 'new-record-uuid-000-0000-000000000001',
    created_at: new Date('2026-04-05T10:00:00Z'),
    isIdempotentDuplicate: false,
  }),
  listRecords: vi.fn().mockResolvedValue({
    data: [MOCK_RECORD],
    next_cursor: null,
    has_more: false,
  }),
  getRecordById: vi.fn().mockResolvedValue({
    ...MOCK_RECORD,
    download_url: 'https://minio.local/presigned-url',
    download_url_expires_at: new Date(Date.now() + 86400000),
  }),
}));

vi.mock('../../src/db/connection.js', () => ({ db: vi.fn() }));

vi.mock('../../src/middleware/auth.js', () => ({
  requireAuth: vi.fn().mockImplementation(async (
    request: { headers: Record<string, string>; user: unknown; url: string },
    reply: { status: (n: number) => { send: (b: unknown) => unknown } },
  ) => {
    const header = request.headers.authorization ?? '';
    const match = header.match(/test-token-(\w+)-(.+)/);
    if (match) {
      request.user = { role: match[1], sub: match[2] };
    } else {
      return reply.status(401).send({
        type: 'https://zyvia.api/errors/unauthorized',
        title: 'Unauthorized',
        status: 401,
        detail: 'Invalid or missing authorization token',
        instance: request.url,
      });
    }
  }),
  requireAdmin: vi.fn(),
  assertPatientAccess: vi.fn().mockReturnValue(true),
}));

let app: FastifyInstance;

beforeAll(async () => {
  const { buildApp } = await import('../../src/app.js');
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  vi.restoreAllMocks();
});

// Helper to build multipart/form-data bodies for upload tests
function buildMultipart(
  boundary: string,
  fields: Record<string, string>,
  file: { name: string; content: Buffer; mimeType: string },
): Buffer {
  const parts: Buffer[] = [];

  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`),
    );
  }

  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.mimeType}\r\n\r\n`,
    ),
  );
  parts.push(file.content);
  parts.push(Buffer.from('\r\n'));
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(parts);
}

const TEST_BOUNDARY = 'test-boundary-abc123';
const TEST_PDF = Buffer.from('%PDF-1.4 test file content');
const RECORD_TYPE_UUID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

describe('POST /v1/upload', () => {
  it('patient uploads without patient_id field and gets 201', async () => {
    const { createRecord } = await import('../../src/services/record.service.js');
    vi.mocked(createRecord).mockResolvedValueOnce({
      id: 'new-record-uuid-000-0000-000000000001',
      created_at: new Date('2026-04-05T10:00:00Z'),
      isIdempotentDuplicate: false,
    });

    const body = buildMultipart(
      TEST_BOUNDARY,
      { record_type_id: RECORD_TYPE_UUID },
      { name: 'blood-test.pdf', content: TEST_PDF, mimeType: 'application/pdf' },
    );

    const res = await app.inject({
      method: 'POST',
      url: '/v1/upload',
      headers: {
        authorization: 'test-token-patient-patient-001',
        'content-type': `multipart/form-data; boundary=${TEST_BOUNDARY}`,
      },
      payload: body,
    });

    expect(res.statusCode).toBe(201);
    const result = JSON.parse(res.body) as { id: string; created_at: string };
    expect(result).toHaveProperty('id');
    expect(result).toHaveProperty('created_at');
    // JWT sub is used, not any form-supplied patient_id
    expect(vi.mocked(createRecord)).toHaveBeenCalledWith(
      expect.objectContaining({ patientId: 'patient-001' }),
    );
  });

  it('patient upload with mismatched patient_id in form uses JWT sub (201)', async () => {
    const { createRecord } = await import('../../src/services/record.service.js');
    vi.mocked(createRecord).mockResolvedValueOnce({
      id: 'new-record-uuid-000-0000-000000000002',
      created_at: new Date('2026-04-05T10:00:00Z'),
      isIdempotentDuplicate: false,
    });

    const body = buildMultipart(
      TEST_BOUNDARY,
      // patient_id in form differs from JWT sub ('patient-001')
      { record_type_id: RECORD_TYPE_UUID, patient_id: 'some-other-patient-uuid' },
      { name: 'blood-test.pdf', content: TEST_PDF, mimeType: 'application/pdf' },
    );

    const res = await app.inject({
      method: 'POST',
      url: '/v1/upload',
      headers: {
        authorization: 'test-token-patient-patient-001',
        'content-type': `multipart/form-data; boundary=${TEST_BOUNDARY}`,
      },
      payload: body,
    });

    expect(res.statusCode).toBe(201);
    // Must use JWT sub, not the form-supplied patient_id
    expect(vi.mocked(createRecord)).toHaveBeenCalledWith(
      expect.objectContaining({ patientId: 'patient-001' }),
    );
  });

  it('provider upload without patient_id returns 422', async () => {
    const body = buildMultipart(
      TEST_BOUNDARY,
      { record_type_id: RECORD_TYPE_UUID },
      { name: 'blood-test.pdf', content: TEST_PDF, mimeType: 'application/pdf' },
    );

    const res = await app.inject({
      method: 'POST',
      url: '/v1/upload',
      headers: {
        authorization: 'test-token-provider-provider-001',
        'content-type': `multipart/form-data; boundary=${TEST_BOUNDARY}`,
      },
      payload: body,
    });

    expect(res.statusCode).toBe(422);
  });

  it('idempotent upload returns 200 with same id on second request', async () => {
    const { createRecord } = await import('../../src/services/record.service.js');
    const idempotentRecord = {
      id: 'idempotent-record-00-0000-000000000001',
      created_at: new Date('2026-04-05T10:00:00Z'),
      isIdempotentDuplicate: true,
    };
    vi.mocked(createRecord).mockResolvedValueOnce(idempotentRecord);

    const body = buildMultipart(
      TEST_BOUNDARY,
      { record_type_id: RECORD_TYPE_UUID },
      { name: 'blood-test.pdf', content: TEST_PDF, mimeType: 'application/pdf' },
    );

    const res = await app.inject({
      method: 'POST',
      url: '/v1/upload',
      headers: {
        authorization: 'test-token-patient-patient-001',
        'content-type': `multipart/form-data; boundary=${TEST_BOUNDARY}`,
        'idempotency-key': 'idempotency-key-abc',
      },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    const result = JSON.parse(res.body) as { id: string };
    expect(result.id).toBe(idempotentRecord.id);
  });

  it('returns 401 without authorization header', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/upload' });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /v1/records', () => {
  it('patient calls with no query params → 200 with data array', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/records',
      headers: { authorization: 'test-token-patient-patient-001' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: unknown[]; has_more: boolean; next_cursor: string | null };
    expect(Array.isArray(body.data)).toBe(true);
    expect(body).toHaveProperty('has_more');
    expect(body).toHaveProperty('next_cursor');
  });

  it('patient calls with a different patient_id → 200 scoped to JWT sub', async () => {
    const { listRecords } = await import('../../src/services/record.service.js');

    const res = await app.inject({
      method: 'GET',
      url: '/v1/records?patient_id=some-other-patient-uuid',
      headers: { authorization: 'test-token-patient-patient-001' },
    });

    expect(res.statusCode).toBe(200);
    // Must be called with JWT sub, not the query-supplied patient_id
    expect(vi.mocked(listRecords)).toHaveBeenCalledWith(
      expect.objectContaining({ patientId: 'patient-001' }),
    );
  });

  it('provider calls without patient_id → 422', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/records',
      headers: { authorization: 'test-token-provider-provider-001' },
    });
    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body) as { detail: string };
    expect(body.detail).toMatch(/patient_id is required for provider role/);
  });

  it('returns 200 with paginated list for a provider with valid patient_id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/records?patient_id=patient-abc-123',
      headers: { authorization: 'test-token-provider-provider-001' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: unknown[]; has_more: boolean; next_cursor: string | null };
    expect(body).toHaveProperty('data');
    expect(Array.isArray(body.data)).toBe(true);
    expect(body).toHaveProperty('has_more');
    expect(body).toHaveProperty('next_cursor');
  });

  it('empty document list returns correct structure (not an error)', async () => {
    const { listRecords } = await import('../../src/services/record.service.js');
    vi.mocked(listRecords).mockResolvedValueOnce({ data: [], next_cursor: null, has_more: false });

    const res = await app.inject({
      method: 'GET',
      url: '/v1/records',
      headers: { authorization: 'test-token-patient-patient-no-records' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: unknown[]; next_cursor: null; has_more: boolean };
    expect(body).toEqual({ data: [], next_cursor: null, has_more: false });
  });

  it('returns 401 without authorization header', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/records?patient_id=patient-001' });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /v1/records/:id', () => {
  it('returns 200 with record detail and download_url', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/records/00000000-0001-0000-0000-000000000001',
      headers: { authorization: 'test-token-provider-provider-001' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      id: string;
      download_url: string;
      download_url_expires_at: string;
    };
    expect(body).toHaveProperty('id');
    expect(body).toHaveProperty('download_url');
    expect(body).toHaveProperty('download_url_expires_at');
  });

  it('returns 404 when record does not exist or belongs to another user', async () => {
    const { getRecordById } = await import('../../src/services/record.service.js');
    vi.mocked(getRecordById).mockRejectedValueOnce(
      Object.assign(new Error('Record not found'), { statusCode: 404 }),
    );

    const res = await app.inject({
      method: 'GET',
      url: '/v1/records/00000000-0000-0000-0000-000000000000',
      headers: { authorization: 'test-token-patient-patient-001' },
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body) as { status: number };
    expect(body.status).toBe(404);
  });

  it('returns 401 without authorization header', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/records/00000000-0000-0000-0000-000000000001',
    });
    expect(res.statusCode).toBe(401);
  });
});
