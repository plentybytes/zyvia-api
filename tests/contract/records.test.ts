/**
 * Contract tests for GET /v1/records and GET /v1/records/:id
 *
 * TDD: These tests define expected HTTP contract behaviour.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { FastifyInstance } from 'fastify';

const MOCK_RECORD_TYPE = {
  id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  name: 'Lab Result',
  description: 'Lab test results',
  is_active: true,
  created_at: new Date('2026-04-01T00:00:00Z'),
  updated_at: new Date('2026-04-01T00:00:00Z'),
};

const MOCK_RECORD = {
  id: 'record-uuid-0001-0000-000000000001',
  patient_id: 'patient-abc-123',
  record_type: MOCK_RECORD_TYPE,
  file_name: 'blood-test.pdf',
  file_size_bytes: 204800,
  mime_type: 'application/pdf',
  created_at: new Date('2026-04-02T10:00:00Z'),
};

vi.mock('../../src/services/record.service.js', () => ({
  createRecord: vi.fn(),
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

vi.mock('../../src/middleware/auth.js', () => ({
  requireAuth: vi.fn().mockImplementation(async (request: { headers: Record<string, string>; user: unknown }) => {
    const header = request.headers.authorization ?? '';
    const match = header.match(/test-token-(\w+)-(.+)/);
    if (match) request.user = { role: match[1], sub: match[2] };
  }),
  requireAdmin: vi.fn(),
  assertPatientAccess: vi.fn().mockReturnValue(true),
}));

let app: FastifyInstance;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://zyvia:zyvia@localhost:5432/zyvia_test';
  process.env.OBJECT_STORE_ENDPOINT = 'http://localhost:9000';
  process.env.OBJECT_STORE_BUCKET = 'health-records';
  process.env.OBJECT_STORE_ACCESS_KEY = 'minioadmin';
  process.env.OBJECT_STORE_SECRET_KEY = 'minioadmin';
  process.env.JWT_PUBLIC_KEY_PATH = './keys/dev-public.pem';

  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  vi.restoreAllMocks();
});

describe('GET /v1/records', () => {
  it('returns 200 with paginated list for a valid patient_id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/records?patient_id=patient-abc-123',
      headers: { authorization: 'test-token-provider-provider-001' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      data: unknown[];
      has_more: boolean;
      next_cursor: string | null;
    };
    expect(body).toHaveProperty('data');
    expect(Array.isArray(body.data)).toBe(true);
    expect(body).toHaveProperty('has_more');
    expect(body).toHaveProperty('next_cursor');
  });

  it('returns 200 with empty data array when patient has no records', async () => {
    const { listRecords } = await import('../../src/services/record.service.js');
    vi.mocked(listRecords).mockResolvedValueOnce({ data: [], next_cursor: null, has_more: false });

    const res = await app.inject({
      method: 'GET',
      url: '/v1/records?patient_id=patient-no-records',
      headers: { authorization: 'test-token-provider-provider-001' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: unknown[] };
    expect(body.data).toHaveLength(0);
  });

  it('returns 401 without authorization header', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/records?patient_id=patient-001' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 422 when patient_id is missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/records',
      headers: { authorization: 'test-token-provider-provider-001' },
    });
    expect(res.statusCode).toBe(422);
  });
});

describe('GET /v1/records/:id', () => {
  it('returns 200 with record detail and download_url', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/records/record-uuid-0001-0000-000000000001',
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

  it('returns 404 when record does not exist', async () => {
    const { getRecordById } = await import('../../src/services/record.service.js');
    vi.mocked(getRecordById).mockRejectedValueOnce(
      Object.assign(new Error('Record not found'), { statusCode: 404 }),
    );

    const res = await app.inject({
      method: 'GET',
      url: '/v1/records/00000000-0000-0000-0000-000000000000',
      headers: { authorization: 'test-token-provider-provider-001' },
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
