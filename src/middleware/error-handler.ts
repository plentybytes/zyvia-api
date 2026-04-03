import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
}

const BASE_URL = 'https://zyvia.api/errors';

const STATUS_TITLES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  413: 'Payload Too Large',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  503: 'Service Unavailable',
};

function toSlug(title: string): string {
  return title.toLowerCase().replace(/\s+/g, '-');
}

export function buildProblem(
  status: number,
  detail: string,
  instance: string,
  titleOverride?: string,
): ProblemDetails {
  const title = titleOverride ?? STATUS_TITLES[status] ?? 'Error';
  return {
    type: `${BASE_URL}/${toSlug(title)}`,
    title,
    status,
    detail,
    instance,
  };
}

export function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  const instance = request.url;

  // Fastify validation errors
  if (error.validation) {
    const detail = error.validation.map((v) => v.message ?? String(v)).join('; ');
    reply.status(422).send(buildProblem(422, detail, instance));
    return;
  }

  // Known HTTP errors with explicit status codes
  if (error.statusCode) {
    const status = error.statusCode;
    reply.status(status).send(buildProblem(status, error.message, instance));
    return;
  }

  // Unexpected errors — don't leak internals
  request.log.error({ err: error }, 'Unhandled error');
  reply.status(500).send(buildProblem(500, 'An unexpected error occurred', instance));
}
