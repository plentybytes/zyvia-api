import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import type { FastifyInstance } from 'fastify';

vi.mock('../../src/config/index.js', async () => {
  const { TEST_CONFIG } = await import('../fixtures/test-keys.js');
  return { config: TEST_CONFIG };
});

vi.mock('../../src/services/medical.service.js', () => ({
  submitQuery: vi.fn(),
}));

vi.mock('../../src/db/connection.js', () => ({ db: vi.fn() }));

import * as medicalService from '../../src/services/medical.service.js';

const mockResponse = {
  query_id: 'query-uuid',
  response_text: 'Based on your profile...\n\n⚠️ MEDICAL DISCLAIMER: ...',
  disclaimer_text: '⚠️ MEDICAL DISCLAIMER: ...',
  created_at: new Date(),
  health_context: { age_years: 35, height_cm: 165, weight_kg: 62.5, bmi: 22.97 },
};

let app: FastifyInstance;
let authToken: string;

beforeAll(async () => {
  const { buildApp } = await import('../../src/app.js');
  app = await buildApp();
  await app.ready();
  authToken = await app.jwt.sign({ sub: 'user-uuid', role: 'patient' }, { expiresIn: '15m' });
});

afterAll(async () => {
  await app.close();
});

describe('POST /v1/medical/query', () => {
  it('returns 201 with AI response', async () => {
    vi.mocked(medicalService.submitQuery).mockResolvedValue(mockResponse);

    const res = await supertest(app.server)
      .post('/v1/medical/query')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ query_text: 'I have been having headaches lately' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      query_id: 'query-uuid',
      disclaimer_text: expect.stringContaining('MEDICAL DISCLAIMER'),
    });
  });

  it('returns 401 without auth token', async () => {
    const res = await supertest(app.server)
      .post('/v1/medical/query')
      .send({ query_text: 'I have been having headaches lately' });

    expect(res.status).toBe(401);
  });

  it('returns 422 for query text too short', async () => {
    const res = await supertest(app.server)
      .post('/v1/medical/query')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ query_text: 'hi' });

    expect(res.status).toBe(422);
  });

  it('returns 422 when health profile is missing', async () => {
    vi.mocked(medicalService.submitQuery).mockRejectedValue(
      Object.assign(new Error('Health profile not found for this user'), { statusCode: 404 }),
    );

    const res = await supertest(app.server)
      .post('/v1/medical/query')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ query_text: 'I have been having headaches lately' });

    expect(res.status).toBe(422);
  });

  it('returns 503 when AI service is unavailable', async () => {
    vi.mocked(medicalService.submitQuery).mockRejectedValue(
      Object.assign(new Error('The medical AI service is temporarily unavailable'), {
        statusCode: 503,
      }),
    );

    const res = await supertest(app.server)
      .post('/v1/medical/query')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ query_text: 'I have been having headaches lately' });

    expect(res.status).toBe(503);
  });
});
