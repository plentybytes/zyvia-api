import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { buildProblem } from '../middleware/error-handler.js';
import { requireAuth } from '../middleware/auth.js';
import * as medicalService from '../services/medical.service.js';

const QueryBodySchema = z.object({
  query_text: z
    .string()
    .min(5, 'query_text must be at least 5 characters')
    .max(2000, 'query_text must be at most 2000 characters'),
});

export async function medicalRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /v1/medical/query
  fastify.post('/medical/query', { preHandler: requireAuth }, async (request, reply) => {
    const parseResult = QueryBodySchema.safeParse(request.body);
    if (!parseResult.success) {
      const detail = parseResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      return reply.status(422).send(buildProblem(422, detail, request.url));
    }

    try {
      const result = await medicalService.submitQuery(
        request.user.sub,
        parseResult.data.query_text,
      );
      return reply.status(201).send(result);
    } catch (err) {
      const error = err as { statusCode?: number; message: string };
      // Map 404 (missing health profile) to 422 with a user-friendly message
      if (error.statusCode === 404) {
        return reply
          .status(422)
          .send(
            buildProblem(
              422,
              'Health profile is incomplete. Please update your profile before submitting a medical query.',
              request.url,
            ),
          );
      }
      const status = error.statusCode ?? 500;
      return reply.status(status).send(buildProblem(status, error.message, request.url));
    }
  });
}
