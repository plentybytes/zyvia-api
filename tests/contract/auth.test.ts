import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import type { FastifyInstance } from 'fastify';

// Mock config before importing app
vi.mock('../../src/config/index.js', async () => {
  const { TEST_CONFIG } = await import('../fixtures/test-keys.js');
  return { config: TEST_CONFIG };
});

vi.mock('../../src/services/auth.service.js', () => ({
  registerUser: vi.fn(),
  verifyCredentials: vi.fn(),
  createRefreshToken: vi.fn(),
  rotateRefreshToken: vi.fn(),
  revokeRefreshToken: vi.fn(),
}));

vi.mock('../../src/db/connection.js', () => ({
  db: vi.fn(),
}));

import * as authService from '../../src/services/auth.service.js';

let app: FastifyInstance;

beforeAll(async () => {
  const { buildApp } = await import('../../src/app.js');
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('POST /v1/auth/register', () => {
  it('returns 201 with valid registration data', async () => {
    vi.mocked(authService.registerUser).mockResolvedValue({
      id: 'user-uuid',
      email: 'jane@example.com',
      role: 'patient',
      created_at: new Date('2026-04-05T10:00:00.000Z'),
    });

    const res = await supertest(app.server)
      .post('/v1/auth/register')
      .send({
        email: 'jane@example.com',
        password: 'Secure#Pass1',
        date_of_birth: '1990-05-15',
        height_cm: 165,
        weight_kg: 62.5,
      });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: 'user-uuid', email: 'jane@example.com' });
  });

  it('returns 409 when email already exists', async () => {
    vi.mocked(authService.registerUser).mockRejectedValue(
      Object.assign(new Error('An account with this email address already exists'), {
        statusCode: 409,
      }),
    );

    const res = await supertest(app.server)
      .post('/v1/auth/register')
      .send({
        email: 'jane@example.com',
        password: 'Secure#Pass1',
        date_of_birth: '1990-05-15',
        height_cm: 165,
        weight_kg: 62.5,
      });

    expect(res.status).toBe(409);
  });

  it('returns 422 for weak password', async () => {
    const res = await supertest(app.server)
      .post('/v1/auth/register')
      .send({
        email: 'jane@example.com',
        password: 'weak',
        date_of_birth: '1990-05-15',
        height_cm: 165,
        weight_kg: 62.5,
      });

    expect(res.status).toBe(422);
  });

  it('returns 422 for missing fields', async () => {
    const res = await supertest(app.server)
      .post('/v1/auth/register')
      .send({ email: 'jane@example.com' });

    expect(res.status).toBe(422);
  });
});

describe('POST /v1/auth/login', () => {
  it('returns 200 with tokens on valid credentials', async () => {
    vi.mocked(authService.verifyCredentials).mockResolvedValue({
      id: 'user-uuid',
      email: 'jane@example.com',
      role: 'patient',
      created_at: new Date(),
    });
    vi.mocked(authService.createRefreshToken).mockResolvedValue('raw-refresh-token');

    const res = await supertest(app.server)
      .post('/v1/auth/login')
      .send({ email: 'jane@example.com', password: 'Secure#Pass1' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      refresh_token: 'raw-refresh-token',
      expires_in: 900,
      token_type: 'Bearer',
    });
    expect(res.body.access_token).toBeDefined();
  });

  it('returns 401 for invalid credentials', async () => {
    vi.mocked(authService.verifyCredentials).mockResolvedValue(null);

    const res = await supertest(app.server)
      .post('/v1/auth/login')
      .send({ email: 'jane@example.com', password: 'wrong' });

    expect(res.status).toBe(401);
  });

  it('returns 423 when account is locked', async () => {
    vi.mocked(authService.verifyCredentials).mockRejectedValue(
      Object.assign(new Error('Account is temporarily locked'), {
        statusCode: 423,
        unlock_at: '2026-04-05T10:15:00.000Z',
      }),
    );

    const res = await supertest(app.server)
      .post('/v1/auth/login')
      .send({ email: 'jane@example.com', password: 'Secure#Pass1' });

    expect(res.status).toBe(423);
    expect(res.body.unlock_at).toBeDefined();
  });
});

describe('POST /v1/auth/refresh', () => {
  it('returns 200 with new access token', async () => {
    vi.mocked(authService.rotateRefreshToken).mockResolvedValue({
      userId: 'user-uuid',
      role: 'patient',
      newRawToken: 'new-refresh-token',
    });

    const res = await supertest(app.server)
      .post('/v1/auth/refresh')
      .send({ refresh_token: 'old-token' });

    expect(res.status).toBe(200);
    expect(res.body.access_token).toBeDefined();
    expect(res.body.expires_in).toBe(900);
  });

  it('returns 401 for invalid refresh token', async () => {
    vi.mocked(authService.rotateRefreshToken).mockRejectedValue(
      Object.assign(new Error('Refresh token is invalid'), { statusCode: 401 }),
    );

    const res = await supertest(app.server)
      .post('/v1/auth/refresh')
      .send({ refresh_token: 'invalid' });

    expect(res.status).toBe(401);
  });
});

describe('POST /v1/auth/logout', () => {
  it('returns 204 on successful logout', async () => {
    vi.mocked(authService.revokeRefreshToken).mockResolvedValue(undefined);

    const res = await supertest(app.server)
      .post('/v1/auth/logout')
      .send({ refresh_token: 'valid-token' });

    expect(res.status).toBe(204);
  });

  it('returns 400 when token already revoked', async () => {
    vi.mocked(authService.revokeRefreshToken).mockRejectedValue(
      Object.assign(new Error('Refresh token not found or already revoked'), { statusCode: 400 }),
    );

    const res = await supertest(app.server)
      .post('/v1/auth/logout')
      .send({ refresh_token: 'already-revoked' });

    expect(res.status).toBe(400);
  });
});
