import type { FastifyRequest, FastifyReply } from 'fastify';
import { buildProblem } from './error-handler.js';

export type UserRole = 'patient' | 'provider' | 'administrator';

export interface AuthUser {
  sub: string;
  role: UserRole;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AuthUser;
    user: AuthUser;
  }
}

/** Synthetic identity injected when auth is bypassed in development mode. */
export const DEV_IDENTITY: AuthUser = { sub: 'dev-patient-001', role: 'patient' };

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  // Dev bypass: skip JWT verification when running locally with no token supplied.
  // NEVER active outside development — fail-secure default.
  if (process.env.NODE_ENV === 'development' && !request.headers.authorization) {
    request.user = DEV_IDENTITY;
    return;
  }

  try {
    await request.jwtVerify();
    const payload = request.user as unknown as Record<string, unknown>;

    if (!payload.sub || !payload.role) {
      reply.status(401).send(buildProblem(401, 'Token missing required claims (sub, role)', request.url));
      return;
    }

    const role = payload.role as string;
    if (!['patient', 'provider', 'administrator'].includes(role)) {
      reply.status(401).send(buildProblem(401, `Unknown role: ${role}`, request.url));
      return;
    }

    // Normalize to AuthUser shape
    request.user = { sub: payload.sub as string, role: role as UserRole };
  } catch {
    reply.status(401).send(buildProblem(401, 'Invalid or missing authorization token', request.url));
  }
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await requireAuth(request, reply);
  if (reply.sent) return;

  if (request.user.role !== 'administrator') {
    reply.status(403).send(buildProblem(403, 'Administrator role required', request.url));
  }
}

export function assertPatientAccess(
  requestPatientId: string,
  user: AuthUser,
  reply: FastifyReply,
  url: string,
): boolean {
  if (user.role === 'administrator') {
    reply.status(403).send(buildProblem(403, 'Administrators cannot access patient records', url));
    return false;
  }
  if (user.role === 'patient' && user.sub !== requestPatientId) {
    reply.status(403).send(buildProblem(403, 'Patients can only access their own records', url));
    return false;
  }
  return true;
}
