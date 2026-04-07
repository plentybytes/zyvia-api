/**
 * Contract tests for GET /v1/record-types, POST /v1/record-types,
 * PATCH /v1/record-types/:id
 *
 * TDD: These tests define the expected HTTP contract.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';

vi.mock('../../src/config/index.js', async () => {
  const { TEST_CONFIG } = await import('../fixtures/test-keys.js');
  return { config: TEST_CONFIG };
});

const SEEDED_TYPES = [
  { id: 'rt-001', name: 'Lab Result', description: null, is_active: true, created_at: new Date(), updated_at: new Date() },
  { id: 'rt-002', name: 'Prescription', description: null, is_active: true, created_at: new Date(), updated_at: new Date() },
];

vi.mock('../../src/db/connection.js', () => ({ db: vi.fn() }));

vi.mock('../../src/services/record-type.service.js', () => ({
  listRecordTypes: vi.fn().mockResolvedValue(SEEDED_TYPES),
  createRecordType: vi.fn().mockResolvedValue({
    id: 'rt-new',
    name: 'Mental Health Note',
    description: 'Psychiatric and psychological records',
    is_active: true,
    created_at: new Date(),
    updated_at: new Date(),
  }),
  updateRecordType: vi.fn().mockResolvedValue({
    id: 'rt-001',
    name: 'Lab Result',
    description: null,
    is_active: false,
    created_at: new Date(),
    updated_at: new Date(),
  }),
  getRecordTypeById: vi.fn(),
}));

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
  requireAdmin: vi.fn().mockImplementation(async (request: { headers: Record<string, string>; user: unknown }, reply: { status: (n: number) => { send: (b: unknown) => void }; sent: boolean }) => {
    const header = request.headers.authorization ?? '';
    const match = header.match(/test-token-(\w+)-(.+)/);
    if (match) {
      request.user = { role: match[1], sub: match[2] };
      if (match[1] !== 'administrator') {
        reply.status(403).send({
          type: 'https://zyvia.api/errors/forbidden',
          title: 'Forbidden',
          status: 403,
          detail: 'Administrator role required',
          instance: '/v1/record-types',
        });
      }
    } else {
      reply.status(401).send({
        type: 'https://zyvia.api/errors/unauthorized',
        title: 'Unauthorized',
        status: 401,
        detail: 'Missing token',
        instance: '/v1/record-types',
      });
    }
  }),
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

describe('GET /v1/record-types', () => {
  it('returns 200 with array of record types for authenticated user', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/record-types',
      headers: { authorization: 'test-token-provider-provider-001' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: unknown[] };
    expect(body).toHaveProperty('data');
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
  });

  it('returns 401 without authorization header', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/record-types' });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /v1/record-types', () => {
  it('returns 201 when admin creates a new record type', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/record-types',
      headers: {
        authorization: 'test-token-administrator-admin-001',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name: 'Mental Health Note', description: 'Psychiatric records' }),
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as {
      id: string;
      name: string;
      is_active: boolean;
    };
    expect(body).toHaveProperty('id');
    expect(body.name).toBe('Mental Health Note');
    expect(body.is_active).toBe(true);
  });

  it('returns 403 when non-admin tries to create record type', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/record-types',
      headers: {
        authorization: 'test-token-provider-provider-001',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name: 'New Type' }),
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body) as { status: number };
    expect(body.status).toBe(403);
  });

  it('returns 409 when record type name already exists', async () => {
    const { createRecordType } = await import('../../src/services/record-type.service.js');
    vi.mocked(createRecordType).mockRejectedValueOnce(
      Object.assign(new Error('A record type with the name "Lab Result" already exists'), {
        statusCode: 409,
      }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/v1/record-types',
      headers: {
        authorization: 'test-token-administrator-admin-001',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name: 'Lab Result' }),
    });

    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body) as { status: number };
    expect(body.status).toBe(409);
  });

  it('returns 422 when name is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/record-types',
      headers: {
        authorization: 'test-token-administrator-admin-001',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ description: 'No name provided' }),
    });

    expect(res.statusCode).toBe(422);
  });

  it('returns 401 without authorization header', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/record-types',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Test' }),
    });

    expect(res.statusCode).toBe(401);
  });
});

describe('PATCH /v1/record-types/:id', () => {
  it('returns 200 when admin soft-deprecates a record type', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/record-types/3fa85f64-5717-4562-b3fc-2c963f66afa6',
      headers: {
        authorization: 'test-token-administrator-admin-001',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ is_active: false }),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { is_active: boolean };
    expect(body.is_active).toBe(false);
  });

  it('returns 403 when non-admin tries to update', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/record-types/3fa85f64-5717-4562-b3fc-2c963f66afa6',
      headers: {
        authorization: 'test-token-provider-provider-001',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ is_active: false }),
    });

    expect(res.statusCode).toBe(403);
  });

  it('returns 404 when record type not found', async () => {
    const { updateRecordType } = await import('../../src/services/record-type.service.js');
    vi.mocked(updateRecordType).mockRejectedValueOnce(
      Object.assign(new Error('Record type not found'), { statusCode: 404 }),
    );

    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/record-types/00000000-0000-0000-0000-000000000000',
      headers: {
        authorization: 'test-token-administrator-admin-001',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ is_active: false }),
    });

    expect(res.statusCode).toBe(404);
  });
});
