import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { buildProblem } from '../middleware/error-handler.js';
import * as authService from '../services/auth.service.js';
import type { LockedError } from '../services/auth.service.js';

const PASSWORD_REGEX = /^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const RegisterBodySchema = z.object({
  email: z.string().email('Must be a valid email address'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(
      PASSWORD_REGEX,
      'Password must contain at least one uppercase letter, one number, and one special character',
    ),
  date_of_birth: z
    .string()
    .regex(DATE_REGEX, 'date_of_birth must be in YYYY-MM-DD format')
    .refine((val) => {
      const dob = new Date(val);
      const now = new Date();
      if (isNaN(dob.getTime()) || dob >= now) return false;
      const ageYears = (now.getTime() - dob.getTime()) / (365.25 * 24 * 3600 * 1000);
      return ageYears <= 120;
    }, 'date_of_birth must be a past date representing a plausible age (0–120 years)'),
  height_cm: z.number().min(20, 'height_cm must be at least 20').max(300, 'height_cm must be at most 300'),
  weight_kg: z.number().min(1, 'weight_kg must be at least 1').max(700, 'weight_kg must be at most 700'),
});

const LoginBodySchema = z.object({
  email: z.string().min(1, 'email is required'),
  password: z.string().min(1, 'password is required'),
});

const RefreshBodySchema = z.object({
  refresh_token: z.string().min(1, 'refresh_token is required'),
});

const LogoutBodySchema = z.object({
  refresh_token: z.string().min(1, 'refresh_token is required'),
});

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /v1/auth/register
  fastify.post('/auth/register', async (request, reply) => {
    const parseResult = RegisterBodySchema.safeParse(request.body);
    if (!parseResult.success) {
      const detail = parseResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      return reply.status(422).send(buildProblem(422, detail, request.url));
    }

    try {
      const user = await authService.registerUser(parseResult.data);
      return reply.status(201).send({
        id: user.id,
        email: user.email,
        created_at: user.created_at,
      });
    } catch (err) {
      const error = err as { statusCode?: number; message: string };
      const status = error.statusCode ?? 500;
      return reply.status(status).send(buildProblem(status, error.message, request.url));
    }
  });

  // POST /v1/auth/login
  fastify.post('/auth/login', async (request, reply) => {
    const parseResult = LoginBodySchema.safeParse(request.body);
    if (!parseResult.success) {
      const detail = parseResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      return reply.status(422).send(buildProblem(422, detail, request.url));
    }

    const { email, password } = parseResult.data;

    try {
      const user = await authService.verifyCredentials(email, password);

      if (!user) {
        return reply.status(401).send(buildProblem(401, 'Invalid email or password', request.url));
      }

      const accessToken = await reply.jwtSign({ sub: user.id, role: user.role }, { expiresIn: '15m' });
      const refreshToken = await authService.createRefreshToken(user.id);

      return reply.status(200).send({
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: 900,
        token_type: 'Bearer',
      });
    } catch (err) {
      const error = err as { statusCode?: number; message: string; unlock_at?: string };
      if (error.statusCode === 423) {
        const lockedErr = err as LockedError;
        return reply.status(423).send({
          ...buildProblem(423, error.message, request.url, 'Locked'),
          unlock_at: lockedErr.unlock_at,
        });
      }
      const status = error.statusCode ?? 500;
      return reply.status(status).send(buildProblem(status, error.message, request.url));
    }
  });

  // POST /v1/auth/refresh
  fastify.post('/auth/refresh', async (request, reply) => {
    const parseResult = RefreshBodySchema.safeParse(request.body);
    if (!parseResult.success) {
      const detail = parseResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      return reply.status(422).send(buildProblem(422, detail, request.url));
    }

    try {
      const { userId, role, newRawToken } = await authService.rotateRefreshToken(
        parseResult.data.refresh_token,
      );
      const accessToken = await reply.jwtSign({ sub: userId, role }, { expiresIn: '15m' });

      return reply.status(200).send({
        access_token: accessToken,
        refresh_token: newRawToken,
        expires_in: 900,
      });
    } catch (err) {
      const error = err as { statusCode?: number; message: string };
      const status = error.statusCode ?? 500;
      return reply.status(status).send(buildProblem(status, error.message, request.url));
    }
  });

  // POST /v1/auth/logout
  fastify.post('/auth/logout', async (request, reply) => {
    const parseResult = LogoutBodySchema.safeParse(request.body);
    if (!parseResult.success) {
      const detail = parseResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      return reply.status(422).send(buildProblem(422, detail, request.url));
    }

    try {
      await authService.revokeRefreshToken(parseResult.data.refresh_token);
      return reply.status(204).send();
    } catch (err) {
      const error = err as { statusCode?: number; message: string };
      const status = error.statusCode ?? 500;
      return reply.status(status).send(buildProblem(status, error.message, request.url));
    }
  });
}
