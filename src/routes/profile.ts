import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { buildProblem } from '../middleware/error-handler.js';
import { requireAuth } from '../middleware/auth.js';
import * as profileService from '../services/health-profile.service.js';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const PatchProfileBodySchema = z
  .object({
    date_of_birth: z
      .string()
      .regex(DATE_REGEX, 'date_of_birth must be in YYYY-MM-DD format')
      .refine((val) => {
        const dob = new Date(val);
        const now = new Date();
        if (isNaN(dob.getTime()) || dob >= now) return false;
        const ageYears = (now.getTime() - dob.getTime()) / (365.25 * 24 * 3600 * 1000);
        return ageYears <= 120;
      }, 'date_of_birth must be a past date representing a plausible age (0–120 years)')
      .optional(),
    height_cm: z
      .number()
      .min(20, 'height_cm must be at least 20')
      .max(300, 'height_cm must be at most 300')
      .optional(),
    weight_kg: z
      .number()
      .min(1, 'weight_kg must be at least 1')
      .max(700, 'weight_kg must be at most 700')
      .optional(),
  })
  .refine(
    (obj) => Object.keys(obj).length > 0,
    'At least one field must be provided (date_of_birth, height_cm, or weight_kg)',
  );

function formatProfile(profile: ReturnType<typeof Object.assign>) {
  return {
    user_id: profile.user_id,
    date_of_birth: profile.date_of_birth,
    height_cm: profile.height_cm,
    weight_kg: profile.weight_kg,
    bmi: profile.bmi,
    age_years: profile.age_years,
    updated_at: profile.updated_at,
  };
}

export async function profileRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /v1/profile
  fastify.get('/profile', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const profile = await profileService.getProfile(request.user.sub);
      return reply.status(200).send(formatProfile(profile));
    } catch (err) {
      const error = err as { statusCode?: number; message: string };
      const status = error.statusCode ?? 500;
      return reply.status(status).send(buildProblem(status, error.message, request.url));
    }
  });

  // PATCH /v1/profile
  fastify.patch('/profile', { preHandler: requireAuth }, async (request, reply) => {
    const parseResult = PatchProfileBodySchema.safeParse(request.body);
    if (!parseResult.success) {
      const detail = parseResult.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
      return reply.status(422).send(buildProblem(422, detail, request.url));
    }

    try {
      const profile = await profileService.updateProfile(request.user.sub, parseResult.data);
      return reply.status(200).send(formatProfile(profile));
    } catch (err) {
      const error = err as { statusCode?: number; message: string };
      const status = error.statusCode ?? 500;
      return reply.status(status).send(buildProblem(status, error.message, request.url));
    }
  });
}
