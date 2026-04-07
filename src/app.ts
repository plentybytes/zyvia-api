import Fastify from 'fastify';
import fastifyMultipart from '@fastify/multipart';
import fastifyJwt from '@fastify/jwt';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import { randomUUID } from 'crypto';
import { config } from './config/index.js';
import { errorHandler } from './middleware/error-handler.js';
import { healthRoutes } from './routes/health.js';
import { recordRoutes } from './routes/records.js';
import { recordTypeRoutes } from './routes/record-types.js';
import { authRoutes } from './routes/auth.js';
import { profileRoutes } from './routes/profile.js';
import { medicalRoutes } from './routes/medical.js';

export async function buildApp() {
  const fastify = Fastify({
    logger: {
      level: config.nodeEnv === 'test' ? 'silent' : 'info',
      serializers: {
        req(request) {
          return {
            method: request.method,
            url: request.url,
            request_id: request.id,
          };
        },
        res(reply) {
          return {
            status: reply.statusCode,
          };
        },
      },
    },
    genReqId: () => randomUUID(),
  });

  // Add request_id + duration_ms to all responses
  fastify.addHook('onResponse', async (request, reply) => {
    request.log.info({
      request_id: request.id,
      method: request.method,
      url: request.url,
      status: reply.statusCode,
      duration_ms: reply.elapsedTime,
    });
  });

  // Register JWT plugin
  fastify.register(fastifyJwt, {
    secret: {
      public: config.jwt.publicKey,
      private: config.jwt.privateKey,
    },
    sign: { algorithm: 'RS256' },
    verify: { algorithms: ['RS256'] },
  });

  // Register multipart for file uploads
  fastify.register(fastifyMultipart, {
    attachFieldsToBody: false,
    limits: {
      fileSize: 50 * 1024 * 1024 + 1, // 50 MB + 1 byte to detect oversize
    },
  });

  // Register OpenAPI docs (development only)
  if (config.nodeEnv !== 'production') {
    await fastify.register(fastifySwagger, {
      openapi: {
        info: { title: 'Zyvia Health Records API', version: '1.0.0' },
        components: {
          securitySchemes: {
            bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
          },
        },
      },
    });
    await fastify.register(fastifySwaggerUi, { routePrefix: '/v1/docs' });
  }

  // Register error handler
  fastify.setErrorHandler(errorHandler);

  // Register routes under /v1
  fastify.register(healthRoutes, { prefix: '/v1' });
  fastify.register(recordRoutes, { prefix: '/v1' });
  fastify.register(recordTypeRoutes, { prefix: '/v1' });
  fastify.register(authRoutes, { prefix: '/v1' });
  fastify.register(profileRoutes, { prefix: '/v1' });
  fastify.register(medicalRoutes, { prefix: '/v1' });

  return fastify;
}
