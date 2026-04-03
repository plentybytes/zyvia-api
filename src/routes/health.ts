import type { FastifyInstance } from 'fastify';
import { db } from '../db/connection.js';
import { checkBucketReachable } from '../services/storage.service.js';
import { buildProblem } from '../middleware/error-handler.js';

export async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/health', { schema: { hide: false } }, async (_request, reply) => {
    return reply.status(200).send({ status: 'ok', version: process.env.npm_package_version ?? '1.0.0' });
  });

  fastify.get('/ready', { schema: { hide: false } }, async (request, reply) => {
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
  });
}
