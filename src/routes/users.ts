import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { buildProblem } from '../middleware/error-handler.js';
import { requireAuth } from '../middleware/auth.js';
import * as userService from '../services/user.service.js';

const CreateUserBodySchema = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email().max(255),
  phone: z.string().max(20).optional(),
  role: z.enum(['patient', 'provider', 'administrator']),
});

const UserSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string', maxLength: 255 },
    email: { type: 'string', format: 'email', maxLength: 255 },
    phone: { type: 'string', maxLength: 20, nullable: true },
    role: { type: 'string', enum: ['patient', 'provider', 'administrator'] },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' },
  },
  required: ['id', 'name', 'email', 'role', 'created_at', 'updated_at'],
};

const UserSummarySchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string', maxLength: 255 },
    email: { type: 'string', format: 'email', maxLength: 255 },
    role: { type: 'string', enum: ['patient', 'provider', 'administrator'] },
    created_at: { type: 'string', format: 'date-time' },
  },
  required: ['id', 'name', 'email', 'role', 'created_at'],
};

const CreateUserRequestSchema = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 255 },
    email: { type: 'string', format: 'email', maxLength: 255 },
    phone: { type: 'string', maxLength: 20 },
    role: { type: 'string', enum: ['patient', 'provider', 'administrator'] },
  },
  required: ['name', 'email', 'role'],
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

export async function userRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /v1/users - Create user (no auth required)
  fastify.post(
    '/users',
    {
      schema: {
        description: 'Create a new user',
        tags: ['Users'],
        body: CreateUserRequestSchema,
        response: {
          201: UserSchema,
          409: ErrorResponseSchema,
          422: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const parseResult = CreateUserBodySchema.safeParse(request.body);
      if (!parseResult.success) {
        const detail = parseResult.error.issues.map((i) => i.message).join('; ');
        return reply.status(422).send(buildProblem(422, detail, request.url));
      }

      try {
        const user = await userService.createUser(parseResult.data);
        return reply.status(201).send(user);
      } catch (err) {
        const error = err as { statusCode?: number; message: string };
        const status = error.statusCode ?? 500;
        return reply.status(status).send(buildProblem(status, error.message, request.url));
      }
    },
  );

  // GET /v1/users - List users (requires auth)
  fastify.get(
    '/users',
    {
      preHandler: requireAuth,
      schema: {
        description: 'List all users',
        tags: ['Users'],
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            type: 'object',
            properties: {
              data: {
                type: 'array',
                items: UserSummarySchema,
              },
            },
            required: ['data'],
          },
          401: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const users = await userService.listUsers();
        return reply.status(200).send({ data: users });
      } catch (err) {
        const error = err as { statusCode?: number; message: string };
        const status = error.statusCode ?? 500;
        return reply.status(status).send(buildProblem(status, error.message, request.url));
      }
    },
  );

  // GET /v1/users/:id - Get user by ID (requires auth)
  fastify.get<{ Params: { id: string } }>(
    '/users/:id',
    {
      preHandler: requireAuth,
      schema: {
        description: 'Get a user by ID',
        tags: ['Users'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
          },
          required: ['id'],
        },
        response: {
          200: UserSchema,
          401: ErrorResponseSchema,
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

      try {
        const user = await userService.getUserById(id);
        return reply.status(200).send(user);
      } catch (err) {
        const error = err as { statusCode?: number; message: string };
        const status = error.statusCode ?? 500;
        return reply.status(status).send(buildProblem(status, error.message, request.url));
      }
    },
  );
}
