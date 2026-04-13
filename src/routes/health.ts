import type { FastifyInstance } from 'fastify';
import { db } from '../db/connection.js';
import { checkBucketReachable } from '../services/storage.service.js';
import { buildProblem } from '../middleware/error-handler.js';

const HealthResponseSchema = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['ok'] },
    version: { type: 'string' },
  },
  required: ['status', 'version'],
};

const ReadyResponseSchema = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['ok'] },
  },
  required: ['status'],
};

const ErrorResponseSchema = {
  type: 'object',
  properties: {
    type: { type: 'string', format: 'uri' },
    title: { type: 'string' },
    status: { type: 'integer' },
    detail: { type: 'string' },
    instance: { type: 'string', format: 'uri' },
  },
  required: ['type', 'title', 'status', 'detail', 'instance'],
};

export async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    '/health',
    {
      schema: {
        description: 'Health check endpoint',
        tags: ['Health'],
        response: {
          200: HealthResponseSchema,
        },
      },
    },
    async (_request, reply) => {
      return reply.status(200).send({ status: 'ok', version: process.env.npm_package_version ?? '1.0.0' });
    },
  );

  fastify.get(
    '/ready',
    {
      schema: {
        description: 'Readiness check endpoint',
        tags: ['Health'],
        response: {
          200: ReadyResponseSchema,
          503: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const checks: string[] = [];

      try {
        await db.raw('SELECT 1');
      } catch {
        checks.push('database unreachable');
      }

      try {
        await checkBucketReachable();
      } catch {
        checks.push('object store unreachable');
      }

      if (checks.length > 0) {
        return reply
          .status(503)
          .send(buildProblem(503, `Service dependencies unavailable: ${checks.join(', ')}`, request.url));
      }

      return reply.status(200).send({ status: 'ok' });
    },
  );
}
