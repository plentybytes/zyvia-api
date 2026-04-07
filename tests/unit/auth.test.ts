/**
 * Unit tests for requireAuth middleware — dev bypass behaviour.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyRequest, FastifyReply } from 'fastify';

// Partial mock types for Fastify request/reply
function makeRequest(overrides: Partial<FastifyRequest> = {}): FastifyRequest {
  return {
    headers: {},
    jwtVerify: vi.fn(),
    user: undefined,
    url: '/v1/test',
    ...overrides,
  } as unknown as FastifyRequest;
}

function makeReply(): FastifyReply & { _status?: number; _body?: unknown } {
  const reply = {
    _status: undefined as number | undefined,
    _body: undefined as unknown,
    status(code: number) {
      this._status = code;
      return this;
    },
    send(body: unknown) {
      this._body = body;
      return this;
    },
    sent: false,
  };
  return reply as unknown as FastifyReply & { _status?: number; _body?: unknown };
}

describe('requireAuth', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    vi.resetModules();
  });

  describe('DEV_IDENTITY export', () => {
    it('exports DEV_IDENTITY with role patient and sub dev-patient-001', async () => {
      const { DEV_IDENTITY } = await import('../../src/middleware/auth.js');
      expect(DEV_IDENTITY.role).toBe('patient');
      expect(DEV_IDENTITY.sub).toBe('dev-patient-001');
    });
  });

  describe('development mode (NODE_ENV=development)', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'development';
    });

    it('bypasses JWT verification and injects dev identity when no Authorization header', async () => {
      vi.resetModules();
      const { requireAuth, DEV_IDENTITY } = await import('../../src/middleware/auth.js');
      const request = makeRequest({ headers: {} });
      const reply = makeReply();

      await requireAuth(request, reply);

      expect(reply._status).toBeUndefined(); // no 401 sent
      expect(request.user).toEqual(DEV_IDENTITY);
      expect(request.jwtVerify).not.toHaveBeenCalled();
    });

    it('dev identity has role patient', async () => {
      vi.resetModules();
      const { requireAuth } = await import('../../src/middleware/auth.js');
      const request = makeRequest({ headers: {} });
      const reply = makeReply();

      await requireAuth(request, reply);

      expect(request.user.role).toBe('patient');
    });

    it('dev identity sub is dev-patient-001', async () => {
      vi.resetModules();
      const { requireAuth } = await import('../../src/middleware/auth.js');
      const request = makeRequest({ headers: {} });
      const reply = makeReply();

      await requireAuth(request, reply);

      expect(request.user.sub).toBe('dev-patient-001');
    });

    it('still calls jwtVerify when Authorization header is present', async () => {
      vi.resetModules();
      const { requireAuth } = await import('../../src/middleware/auth.js');
      const jwtVerify = vi.fn().mockResolvedValue(undefined);
      const request = makeRequest({
        headers: { authorization: 'Bearer some.jwt.token' },
        jwtVerify,
        // simulate jwt setting user after verify
        user: { sub: 'real-user', role: 'provider' } as never,
      });
      const reply = makeReply();

      await requireAuth(request, reply);

      expect(jwtVerify).toHaveBeenCalled();
    });
  });

  describe('non-development mode (NODE_ENV=production)', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
    });

    it('sends 401 when no Authorization header is present', async () => {
      vi.resetModules();
      const { requireAuth } = await import('../../src/middleware/auth.js');
      const request = makeRequest({ headers: {} });
      const reply = makeReply();

      await requireAuth(request, reply);

      expect(reply._status).toBe(401);
      expect(reply._body).toMatchObject({ status: 401 });
    });

    it('does not inject dev identity in production mode', async () => {
      vi.resetModules();
      const { requireAuth } = await import('../../src/middleware/auth.js');
      const request = makeRequest({ headers: {} });
      const reply = makeReply();

      await requireAuth(request, reply);

      expect(request.user?.sub).not.toBe('dev-patient-001');
    });
  });

  describe('undefined NODE_ENV (fail-secure)', () => {
    beforeEach(() => {
      delete process.env.NODE_ENV;
    });

    it('enforces auth when NODE_ENV is unset', async () => {
      vi.resetModules();
      const { requireAuth } = await import('../../src/middleware/auth.js');
      const request = makeRequest({ headers: {} });
      const reply = makeReply();

      await requireAuth(request, reply);

      expect(reply._status).toBe(401);
    });
  });
});
