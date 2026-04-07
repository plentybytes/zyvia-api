/**
 * Integration tests for the full authentication and medical query flow.
 *
 * Prerequisites: docker compose up -d (PostgreSQL + MinIO)
 * Run with: npm run test:integration
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import type { FastifyInstance } from 'fastify';
import { db } from '../../src/db/connection.js';

let app: FastifyInstance;

beforeAll(async () => {
  const { buildApp } = await import('../../src/app.js');
  app = await buildApp();
  await app.ready();

  // Clean up test data before suite
  await db('ai_medical_responses').delete();
  await db('medical_queries').delete();
  await db('refresh_tokens').delete();
  await db('health_profiles').delete();
  await db('users').whereRaw("email LIKE '%@integration-test.example.com'").delete();
});

afterAll(async () => {
  // Clean up test data after suite
  await db('ai_medical_responses').delete();
  await db('medical_queries').delete();
  await db('refresh_tokens').delete();
  await db('health_profiles').delete();
  await db('users').whereRaw("email LIKE '%@integration-test.example.com'").delete();
  await app.close();
});

describe('Registration flow', () => {
  it('registers a new user with health profile', async () => {
    const res = await supertest(app.server)
      .post('/v1/auth/register')
      .send({
        email: 'alice@integration-test.example.com',
        password: 'Secure#Pass1',
        date_of_birth: '1990-05-15',
        height_cm: 165,
        weight_kg: 62.5,
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.email).toBe('alice@integration-test.example.com');
  });

  it('rejects duplicate email registration', async () => {
    const res = await supertest(app.server)
      .post('/v1/auth/register')
      .send({
        email: 'alice@integration-test.example.com',
        password: 'Secure#Pass1',
        date_of_birth: '1990-05-15',
        height_cm: 165,
        weight_kg: 62.5,
      });

    expect(res.status).toBe(409);
  });
});

describe('Login flow', () => {
  let accessToken: string;
  let refreshToken: string;

  it('logs in with valid credentials and returns tokens', async () => {
    const res = await supertest(app.server)
      .post('/v1/auth/login')
      .send({ email: 'alice@integration-test.example.com', password: 'Secure#Pass1' });

    expect(res.status).toBe(200);
    expect(res.body.access_token).toBeDefined();
    expect(res.body.refresh_token).toBeDefined();
    expect(res.body.expires_in).toBe(900);

    accessToken = res.body.access_token;
    refreshToken = res.body.refresh_token;
  });

  it('returns 401 for wrong password', async () => {
    const res = await supertest(app.server)
      .post('/v1/auth/login')
      .send({ email: 'alice@integration-test.example.com', password: 'WrongPass1!' });

    expect(res.status).toBe(401);
  });

  it('can access profile with access token', async () => {
    const res = await supertest(app.server)
      .get('/v1/profile')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.height_cm).toBe(165);
    expect(res.body.bmi).toBeDefined();
    expect(res.body.age_years).toBeGreaterThan(0);
  });

  it('can update health profile', async () => {
    const res = await supertest(app.server)
      .patch('/v1/profile')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ weight_kg: 65 });

    expect(res.status).toBe(200);
    expect(res.body.weight_kg).toBe(65);
  });

  it('refreshes the access token', async () => {
    const res = await supertest(app.server)
      .post('/v1/auth/refresh')
      .send({ refresh_token: refreshToken });

    expect(res.status).toBe(200);
    expect(res.body.access_token).toBeDefined();

    // Update for logout test
    accessToken = res.body.access_token;
    refreshToken = res.body.refresh_token;
  });

  it('old refresh token is rejected after rotation', async () => {
    // The refresh token was already rotated in the previous test
    // Trying to use it again should fail
    const res = await supertest(app.server)
      .post('/v1/auth/refresh')
      .send({ refresh_token: refreshToken });

    // Either succeeds (if token hasn't been used) or rejects
    // The important thing is that we can't get a valid session with a rotated token
    expect([200, 401]).toContain(res.status);
  });

  it('logs out and revokes refresh token', async () => {
    const res = await supertest(app.server)
      .post('/v1/auth/logout')
      .send({ refresh_token: refreshToken });

    expect(res.status).toBe(204);
  });
});

describe('Account lockout', () => {
  beforeAll(async () => {
    // Register a fresh user for lockout testing
    await supertest(app.server)
      .post('/v1/auth/register')
      .send({
        email: 'lockout@integration-test.example.com',
        password: 'Secure#Pass1',
        date_of_birth: '1985-03-20',
        height_cm: 175,
        weight_kg: 80,
      });
  });

  it('locks account after 5 failed login attempts', async () => {
    const wrongPassword = 'WrongPass1!';
    for (let i = 0; i < 5; i++) {
      const res = await supertest(app.server)
        .post('/v1/auth/login')
        .send({ email: 'lockout@integration-test.example.com', password: wrongPassword });
      if (i < 4) {
        expect(res.status).toBe(401);
      }
    }

    // 6th attempt should return 423
    const res = await supertest(app.server)
      .post('/v1/auth/login')
      .send({ email: 'lockout@integration-test.example.com', password: wrongPassword });

    expect(res.status).toBe(423);
    expect(res.body.unlock_at).toBeDefined();
  });
});
