/**
 * Contract tests for POST /v1/upload
 *
 * TDD: These tests define the expected behaviour. They should be confirmed
 * FAILING before the route implementation, then passing after.
 *
 * These tests mock storage and DB to focus on HTTP contract conformance.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { FastifyInstance } from 'fastify';
import FormData from 'form-data';

// --- Mocks ---
vi.mock('../../src/db/connection.js', () => ({
  db: Object.assign(
    vi.fn().mockReturnValue({
      where: vi.fn().mockReturnThis(),
      whereNull: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue(null),
      insert: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ id: 'test-record-id', created_at: new Date() }]),
      fn: { now: vi.fn() },
      raw: vi.fn().mockResolvedValue(undefined),
    }),
    { fn: { now: vi.fn() }, raw: vi.fn().mockResolvedValue(undefined) },
  ),
}));

vi.mock('../../src/services/storage.service.js', () => ({
  uploadFile: vi.fn().mockResolvedValue(undefined),
  generatePresignedUrl: vi.fn().mockResolvedValue('https://example.com/presigned'),
  checkBucketReachable: vi.fn().mockResolvedValue(undefined),
  buildStorageKey: vi.fn().mockReturnValue('patients/test/records/id/file.pdf'),
}));

// --- Helpers ---
function makeJwt(role: string, sub: string): string {
  // For contract tests we bypass real JWT verification with a test token.
  // In a real test environment, generate a proper signed token using the dev key.
  // Here we use a placeholder — the auth middleware is mocked via preHandler override.
  return `test-token-${role}-${sub}`;
}

let app: FastifyInstance;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://zyvia:zyvia@localhost:5432/zyvia_test';
  process.env.OBJECT_STORE_ENDPOINT = 'http://localhost:9000';
  process.env.OBJECT_STORE_BUCKET = 'health-records';
  process.env.OBJECT_STORE_ACCESS_KEY = 'minioadmin';
  process.env.OBJECT_STORE_SECRET_KEY = 'minioadmin';
  process.env.JWT_PUBLIC_KEY_PATH = './keys/dev-public.pem';

  // Mock auth middleware so we can inject any user
  vi.mock('../../src/middleware/auth.js', () => ({
    requireAuth: vi.fn().mockImplementation(async (request: { headers: Record<string, string>; user: unknown }) => {
      const header = request.headers.authorization ?? '';
      const match = header.match(/test-token-(\w+)-(.+)/);
      if (match) {
        request.user = { role: match[1], sub: match[2] };
      }
    }),
    requireAdmin: vi.fn().mockImplementation(async (request: { headers: Record<string, string>; user: unknown }) => {
      const header = request.headers.authorization ?? '';
      const match = header.match(/test-token-(\w+)-(.+)/);
      if (match) {
        request.user = { role: match[1], sub: match[2] };
      }
    }),
    assertPatientAccess: vi.fn().mockReturnValue(true),
  }));

  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  vi.restoreAllMocks();
});

describe('POST /v1/upload', () => {
  it('returns 201 with record ID on successful upload', async () => {
    const form = new FormData();
    form.append('patient_id', 'patient-001');
    form.append('record_type_id', '3fa85f64-5717-4562-b3fc-2c963f66afa6');
    form.append('file', Buffer.from('%PDF-1.4 test content'), {
      filename: 'test.pdf',
      contentType: 'application/pdf',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/upload',
      headers: {
        ...form.getHeaders(),
        authorization: makeJwt('provider', 'provider-001'),
      },
      payload: form.getBuffer(),
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as { id: string; created_at: string };
    expect(body).toHaveProperty('id');
    expect(body).toHaveProperty('created_at');
  });

  it('returns 401 when no authorization header provided', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/upload',
      payload: {},
    });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body) as { type: string; status: number };
    expect(body.status).toBe(401);
    expect(body).toHaveProperty('type');
    expect(body).toHaveProperty('detail');
  });

  it('returns 422 when file type is not supported', async () => {
    const { assertPatientAccess } = await import('../../src/middleware/auth.js');
    vi.mocked(assertPatientAccess).mockReturnValue(true);

    const form = new FormData();
    form.append('patient_id', 'patient-001');
    form.append('record_type_id', '3fa85f64-5717-4562-b3fc-2c963f66afa6');
    form.append('file', Buffer.from('GIF89a...'), {
      filename: 'image.gif',
      contentType: 'image/gif',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/upload',
      headers: {
        ...form.getHeaders(),
        authorization: makeJwt('provider', 'provider-001'),
      },
      payload: form.getBuffer(),
    });

    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body) as { status: number; detail: string };
    expect(body.status).toBe(422);
    expect(body.detail).toMatch(/unsupported file type/i);
  });

  it('returns 422 when required fields are missing', async () => {
    const form = new FormData();
    form.append('file', Buffer.from('%PDF content'), {
      filename: 'test.pdf',
      contentType: 'application/pdf',
    });
    // Missing patient_id and record_type_id

    const res = await app.inject({
      method: 'POST',
      url: '/v1/upload',
      headers: {
        ...form.getHeaders(),
        authorization: makeJwt('provider', 'provider-001'),
      },
      payload: form.getBuffer(),
    });

    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body) as { status: number };
    expect(body.status).toBe(422);
  });

  it('returns RFC 7807 Problem Details structure on error', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/upload',
    });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(body).toHaveProperty('type');
    expect(body).toHaveProperty('title');
    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('detail');
    expect(body).toHaveProperty('instance');
  });
});
