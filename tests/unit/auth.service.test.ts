import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as argon2 from 'argon2';
import { createHash } from 'crypto';

// Mock the database connection before importing the service
vi.mock('../../src/db/connection.js', () => ({
  db: Object.assign(
    vi.fn(() => ({
      whereRaw: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue(null),
      insert: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue(1),
      join: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
    })),
    {
      transaction: vi.fn(),
      fn: { now: vi.fn().mockReturnValue('NOW()') },
      raw: vi.fn((sql: string) => sql),
    },
  ),
}));

describe('auth.service — password hashing', () => {
  it('argon2id hash can be verified', async () => {
    const password = 'TestPassword1!';
    const hash = await argon2.hash(password, { type: argon2.argon2id });
    expect(await argon2.verify(hash, password)).toBe(true);
    expect(await argon2.verify(hash, 'wrong')).toBe(false);
  });

  it('produces different hashes for the same password', async () => {
    const password = 'TestPassword1!';
    const hash1 = await argon2.hash(password, { type: argon2.argon2id });
    const hash2 = await argon2.hash(password, { type: argon2.argon2id });
    expect(hash1).not.toBe(hash2);
  });
});

describe('auth.service — token hashing', () => {
  it('SHA-256 produces consistent 64-char hex', () => {
    const token = 'some-uuid-token';
    const hash = createHash('sha256').update(token).digest('hex');
    expect(hash).toHaveLength(64);
    expect(hash).toBe(createHash('sha256').update(token).digest('hex')); // deterministic
  });
});

describe('auth.service — verifyCredentials lockout logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when user not found', async () => {
    const { db } = await import('../../src/db/connection.js');
    const mockChain = {
      whereRaw: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue(null),
    };
    vi.mocked(db).mockReturnValue(mockChain as unknown as ReturnType<typeof db>);

    const { verifyCredentials } = await import('../../src/services/auth.service.js');
    const result = await verifyCredentials('unknown@example.com', 'Password1!');
    expect(result).toBeNull();
  });

  it('throws 423 when account is locked', async () => {
    const { db } = await import('../../src/db/connection.js');
    const futureDate = new Date(Date.now() + 10 * 60 * 1000);
    const mockChain = {
      whereRaw: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
        password_hash: 'hash',
        role: 'patient',
        failed_login_attempts: 5,
        locked_until: futureDate,
      }),
    };
    vi.mocked(db).mockReturnValue(mockChain as unknown as ReturnType<typeof db>);

    const { verifyCredentials } = await import('../../src/services/auth.service.js');
    await expect(verifyCredentials('test@example.com', 'Password1!')).rejects.toMatchObject({
      statusCode: 423,
    });
  });
});
