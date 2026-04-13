import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { buildProblem } from '../middleware/error-handler.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import * as recordTypeService from '../services/record-type.service.js';

const CreateBodySchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
});

const UpdateBodySchema = z.object({
  description: z.string().max(1000).optional(),
  is_active: z.boolean().optional(),
});

const RecordTypeSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string', maxLength: 255 },
    description: { type: 'string', maxLength: 1000, nullable: true },
    is_active: { type: 'boolean' },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' },
  },
  required: ['id', 'name', 'is_active', 'created_at', 'updated_at'],
};

const CreateRecordTypeRequestSchema = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 255 },
    description: { type: 'string', maxLength: 1000 },
  },
  required: ['name'],
};

const UpdateRecordTypeRequestSchema = {
  type: 'object',
  properties: {
    description: { type: 'string', maxLength: 1000 },
    is_active: { type: 'boolean' },
  },
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

export async function recordTypeRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /v1/record-types
  fastify.get(
    '/record-types',
    {
      preHandler: requireAuth,
      schema: {
        description: 'List record types',
        tags: ['Record Types'],
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          properties: {
            include_inactive: { type: 'boolean', description: 'Include inactive record types (admin only)' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              data: {
                type: 'array',
                items: RecordTypeSchema,
              },
            },
            required: ['data'],
          },
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const query = request.query as { include_inactive?: string };
      const includeInactive = query.include_inactive === 'true';

      // Only admins may see inactive types
      if (includeInactive && request.user.role !== 'administrator') {
        return reply
          .status(403)
          .send(buildProblem(403, 'Only administrators can view inactive record types', request.url));
      }

      const types = await recordTypeService.listRecordTypes({ includeInactive });
      return reply.status(200).send({ data: types });
    },
  );

  // POST /v1/record-types
  fastify.post(
    '/record-types',
    {
      preHandler: requireAdmin,
      schema: {
        description: 'Create a new record type',
        tags: ['Record Types'],
        security: [{ bearerAuth: [] }],
        body: CreateRecordTypeRequestSchema,
        response: {
          201: RecordTypeSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          409: ErrorResponseSchema,
          422: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const parseResult = CreateBodySchema.safeParse(request.body);
      if (!parseResult.success) {
        const detail = parseResult.error.issues.map((i) => i.message).join('; ');
        return reply.status(422).send(buildProblem(422, detail, request.url));
      }

      try {
        const recordType = await recordTypeService.createRecordType(parseResult.data);
        return reply.status(201).send(recordType);
      } catch (err) {
        const error = err as { statusCode?: number; message: string };
        const status = error.statusCode ?? 500;
        return reply.status(status).send(buildProblem(status, error.message, request.url));
      }
    },
  );

  // PATCH /v1/record-types/:id
  fastify.patch<{ Params: { id: string } }>(
    '/record-types/:id',
    {
      preHandler: requireAdmin,
      schema: {
        description: 'Update a record type',
        tags: ['Record Types'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
          },
          required: ['id'],
        },
        body: UpdateRecordTypeRequestSchema,
        response: {
          200: RecordTypeSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          422: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(id)) {
        return reply.status(422).send(buildProblem(422, 'id must be a valid UUID', request.url));
      }

      const parseResult = UpdateBodySchema.safeParse(request.body);
      if (!parseResult.success) {
        const detail = parseResult.error.issues.map((i) => i.message).join('; ');
        return reply.status(422).send(buildProblem(422, detail, request.url));
      }

      try {
        const updated = await recordTypeService.updateRecordType(id, parseResult.data);
        return reply.status(200).send(updated);
      } catch (err) {
        const error = err as { statusCode?: number; message: string };
        const status = error.statusCode ?? 500;
        return reply.status(status).send(buildProblem(status, error.message, request.url));
      }
    },
  );
}
