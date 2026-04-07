import type { FastifyRequest, FastifyReply } from 'fastify';
import { buildProblem } from './error-handler.js';

export type UserRole = 'patient' | 'provider' | 'administrator';

export interface AuthUser {
  sub: string;
  role: UserRole;
}

// Extend @fastify/jwt's own interface so request.user is typed correctly
declare module '@fastify/jwt' {
  interface FastifyJWT {
    user: AuthUser;
  }
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
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
