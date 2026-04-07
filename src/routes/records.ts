import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { buildProblem } from '../middleware/error-handler.js';
import { requireAuth } from '../middleware/auth.js';
import * as recordService from '../services/record.service.js';
import { ALLOWED_MIME_TYPES, MAX_FILE_SIZE_BYTES } from '../models/health-record.js';

const ListQuerySchema = z.object({
  patient_id: z.string().min(1).max(255).optional(),
  record_type_id: z.string().uuid().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export async function recordRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /v1/upload
  fastify.post(
    '/upload',
    { preHandler: requireAuth },
    async (request, reply) => {
      const idempotencyKey = request.headers['idempotency-key'] as string | undefined;

      const data = await request.file({ limits: { fileSize: MAX_FILE_SIZE_BYTES + 1 } });

      if (!data) {
        return reply.status(422).send(buildProblem(422, 'No file provided in request', request.url));
      }

      // Parse form fields
      const fields = data.fields as Record<string, { value: string }>;
      const recordTypeId = fields.record_type_id?.value;

      if (!recordTypeId) {
        return reply
          .status(422)
          .send(buildProblem(422, 'record_type_id is required', request.url));
      }

      // Validate UUID format for record_type_id
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(recordTypeId)) {
        return reply.status(422).send(buildProblem(422, 'record_type_id must be a valid UUID', request.url));
      }

      // Derive patient_id from JWT for patients; require explicit field for providers
      let patientId: string;
      if (request.user.role === 'patient') {
        patientId = request.user.sub;
      } else {
        const formPatientId = fields.patient_id?.value;
        if (!formPatientId) {
          return reply.status(422).send(buildProblem(422, 'patient_id is required for provider role', request.url));
        }
        if (!uuidRegex.test(formPatientId)) {
          return reply.status(422).send(buildProblem(422, 'patient_id must be a valid UUID', request.url));
        }
        patientId = formPatientId;
      }

      // Validate MIME type
      const mimeType = data.mimetype;
      if (!ALLOWED_MIME_TYPES.includes(mimeType as typeof ALLOWED_MIME_TYPES[number])) {
        return reply
          .status(422)
          .send(
            buildProblem(
              422,
              `Unsupported file type: ${mimeType}. Allowed: ${ALLOWED_MIME_TYPES.join(', ')}`,
              request.url,
            ),
          );
      }

      // Check file size from headers before streaming
      const contentLength = Number(request.headers['content-length'] ?? 0);
      if (contentLength > MAX_FILE_SIZE_BYTES) {
        return reply
          .status(413)
          .send(buildProblem(413, 'File exceeds 50 MB size limit', request.url));
      }

      try {
        const result = await recordService.createRecord({
          patientId,
          recordTypeId,
          uploadedByUserId: request.user.sub,
          fileName: data.filename,
          fileSizeBytes: contentLength || 0,
          mimeType: mimeType as typeof ALLOWED_MIME_TYPES[number],
          fileStream: data.file,
          idempotencyKey,
        });

        const statusCode = result.isIdempotentDuplicate ? 200 : 201;
        return reply.status(statusCode).send({ id: result.id, created_at: result.created_at });
      } catch (err) {
        const error = err as NodeJS.ErrnoException & { statusCode?: number };
        const status = error.statusCode ?? 500;
        if (status === 503) {
          return reply.status(503).send(buildProblem(503, 'Object store unavailable', request.url));
        }
        return reply.status(status).send(buildProblem(status, error.message, request.url));
      }
    },
  );

  // GET /v1/records
  fastify.get(
    '/records',
    { preHandler: requireAuth },
    async (request, reply) => {
      const parseResult = ListQuerySchema.safeParse(request.query);
      if (!parseResult.success) {
        const detail = parseResult.error.issues.map((i) => i.message).join('; ');
        return reply.status(422).send(buildProblem(422, detail, request.url));
      }

      const { patient_id: queryPatientId, record_type_id, cursor, limit } = parseResult.data;

      // Derive patient_id from JWT for patients; require query param for providers
      let patientId: string;
      if (request.user.role === 'patient') {
        patientId = request.user.sub;
      } else {
        if (!queryPatientId) {
          return reply.status(422).send(buildProblem(422, 'patient_id is required for provider role', request.url));
        }
        patientId = queryPatientId;
      }

      const result = await recordService.listRecords({
        patientId,
        recordTypeId: record_type_id,
        cursor,
        limit,
      });

      return reply.status(200).send(result);
    },
  );

  // GET /v1/records/:id
  fastify.get<{ Params: { id: string } }>(
    '/records/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { id } = request.params;
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(id)) {
        return reply.status(422).send(buildProblem(422, 'id must be a valid UUID', request.url));
      }

      if (request.user.role === 'administrator') {
        return reply.status(403).send(buildProblem(403, 'Administrators cannot access patient records', request.url));
      }

      // For providers we need the patient_id from the record itself; we pass
      // the caller's ID and let the service handle ownership.
      const patientId = request.user.role === 'patient' ? request.user.sub : '';

      try {
        const record = await recordService.getRecordById(id, patientId === '' ? '__provider__' : patientId);

        // For providers, bypass the patient_id check done inside the service
        if (request.user.role === 'provider') {
          const fullRecord = await recordService.getRecordById(id, record.patient_id);
          return reply.status(200).send(fullRecord);
        }

        return reply.status(200).send(record);
      } catch (err) {
        const error = err as { statusCode?: number; message: string };
        const status = error.statusCode ?? 500;
        return reply.status(status).send(buildProblem(status, error.message, request.url));
      }
    },
  );
}
