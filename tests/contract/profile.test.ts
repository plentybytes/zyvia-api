import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import type { FastifyInstance } from 'fastify';

vi.mock('../../src/config/index.js', async () => {
  const { TEST_CONFIG } = await import('../fixtures/test-keys.js');
  return { config: TEST_CONFIG };
});

vi.mock('../../src/services/health-profile.service.js', () => ({
  getProfile: vi.fn(),
  updateProfile: vi.fn(),
}));

vi.mock('../../src/db/connection.js', () => ({ db: vi.fn() }));

import * as profileService from '../../src/services/health-profile.service.js';

const mockProfile = {
  id: 'profile-uuid',
  user_id: 'user-uuid',
  date_of_birth: '1990-05-15',
  height_cm: 165,
  weight_kg: 62.5,
  bmi: 22.97,
  age_years: 35,
  created_at: new Date(),
  updated_at: new Date(),
};

let app: FastifyInstance;
let authToken: string;

beforeAll(async () => {
  const { buildApp } = await import('../../src/app.js');
  app = await buildApp();
  await app.ready();
  // Generate a test token
  authToken = await app.jwt.sign({ sub: 'user-uuid', role: 'patient' }, { expiresIn: '15m' });
});

afterAll(async () => {
  await app.close();
});

describe('GET /v1/profile', () => {
  it('returns 200 with profile for authenticated user', async () => {
    vi.mocked(profileService.getProfile).mockResolvedValue(mockProfile);

    const res = await supertest(app.server)
      .get('/v1/profile')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      user_id: 'user-uuid',
      height_cm: 165,
      weight_kg: 62.5,
      bmi: 22.97,
      age_years: 35,
    });
  });

  it('returns 401 without auth token', async () => {
    const res = await supertest(app.server).get('/v1/profile');
    expect(res.status).toBe(401);
  });

  it('returns 404 when profile not found', async () => {
    vi.mocked(profileService.getProfile).mockRejectedValue(
      Object.assign(new Error('Health profile not found for this user'), { statusCode: 404 }),
    );

    const res = await supertest(app.server)
      .get('/v1/profile')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(404);
  });
});

describe('PATCH /v1/profile', () => {
  it('returns 200 with updated profile', async () => {
    const updated = { ...mockProfile, weight_kg: 65, bmi: 23.88 };
    vi.mocked(profileService.updateProfile).mockResolvedValue(updated);

    const res = await supertest(app.server)
      .patch('/v1/profile')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ weight_kg: 65 });

    expect(res.status).toBe(200);
    expect(res.body.weight_kg).toBe(65);
  });

  it('returns 401 without auth token', async () => {
    const res = await supertest(app.server)
      .patch('/v1/profile')
      .send({ weight_kg: 65 });
    expect(res.status).toBe(401);
  });

  it('returns 422 for empty body', async () => {
    const res = await supertest(app.server)
      .patch('/v1/profile')
      .set('Authorization', `Bearer ${authToken}`)
      .send({});

    expect(res.status).toBe(422);
  });

  it('returns 422 for out-of-range weight', async () => {
    const res = await supertest(app.server)
      .patch('/v1/profile')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ weight_kg: -1 });

    expect(res.status).toBe(422);
  });
});
