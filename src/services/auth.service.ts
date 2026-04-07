import * as argon2 from 'argon2';
import { createHash, randomUUID } from 'crypto';
import { db } from '../db/connection.js';
import type { UserPublic } from '../models/user.js';

const LOCK_THRESHOLD = 5;
const LOCK_DURATION_MINUTES = 15;
const REFRESH_TOKEN_TTL_DAYS = 7;

// ─── Registration ────────────────────────────────────────────────────────────

export interface RegisterInput {
  email: string;
  password: string;
  date_of_birth: string;
  height_cm: number;
  weight_kg: number;
}

export async function registerUser(input: RegisterInput): Promise<UserPublic> {
  const email = input.email.toLowerCase();

  const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });

  return db.transaction(async (trx) => {
    // Check for duplicate email (case-insensitive via index)
    const existing = await trx('users').whereRaw('LOWER(email) = ?', [email]).first();
    if (existing) {
      const err = Object.assign(new Error('An account with this email address already exists'), {
        statusCode: 409,
      });
      throw err;
    }

    const [user] = await trx('users')
      .insert({ email, password_hash: passwordHash })
      .returning(['id', 'email', 'role', 'created_at']);

    await trx('health_profiles').insert({
      user_id: user.id,
      date_of_birth: input.date_of_birth,
      height_cm: input.height_cm,
      weight_kg: input.weight_kg,
    });

    return user as UserPublic;
  });
}

// ─── Login ───────────────────────────────────────────────────────────────────

export interface LockedError extends Error {
  statusCode: 423;
  unlock_at: string;
}

export async function verifyCredentials(
  email: string,
  password: string,
): Promise<UserPublic | null> {
  const normalizedEmail = email.toLowerCase();

  const user = await db('users').whereRaw('LOWER(email) = ?', [normalizedEmail]).first();

  // Unknown email — return null (caller returns 401; same response as wrong password)
  if (!user) {
    return null;
  }

  // Check if account is locked
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    const err = Object.assign(new Error('Account is temporarily locked due to too many failed login attempts'), {
      statusCode: 423,
      unlock_at: new Date(user.locked_until).toISOString(),
    }) as LockedError;
    throw err;
  }

  const valid = await argon2.verify(user.password_hash, password);

  if (!valid) {
    const newAttempts = user.failed_login_attempts + 1;
    const shouldLock = newAttempts >= LOCK_THRESHOLD;

    await db('users')
      .where({ id: user.id })
      .update({
        failed_login_attempts: newAttempts,
        account_status: shouldLock ? 'locked' : 'active',
        locked_until: shouldLock
          ? db.raw(`NOW() + INTERVAL '${LOCK_DURATION_MINUTES} minutes'`)
          : null,
        updated_at: db.fn.now(),
      });

    return null;
  }

  // Successful login — reset lockout state
  await db('users').where({ id: user.id }).update({
    failed_login_attempts: 0,
    account_status: 'active',
    locked_until: null,
    updated_at: db.fn.now(),
  });

  return {
    id: user.id,
    email: user.email,
    role: user.role,
    created_at: user.created_at,
  } as UserPublic;
}

// ─── Refresh tokens ──────────────────────────────────────────────────────────

function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

export async function createRefreshToken(userId: string): Promise<string> {
  const rawToken = randomUUID();
  const tokenHash = hashToken(rawToken);

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_TTL_DAYS);

  await db('refresh_tokens').insert({
    user_id: userId,
    token_hash: tokenHash,
    expires_at: expiresAt,
  });

  return rawToken;
}

export interface RotatedToken {
  userId: string;
  role: string;
  newRawToken: string;
}

export async function rotateRefreshToken(rawToken: string): Promise<RotatedToken> {
  const tokenHash = hashToken(rawToken);

  const stored = await db('refresh_tokens')
    .join('users', 'refresh_tokens.user_id', 'users.id')
    .where('refresh_tokens.token_hash', tokenHash)
    .where('refresh_tokens.revoked', false)
    .where('refresh_tokens.expires_at', '>', db.fn.now())
    .select(
      'refresh_tokens.id as token_id',
      'users.id as user_id',
      'users.role',
    )
    .first();

  if (!stored) {
    throw Object.assign(new Error('Refresh token is invalid, expired, or has been revoked'), {
      statusCode: 401,
    });
  }

  // Revoke old token
  await db('refresh_tokens').where({ id: stored.token_id }).update({ revoked: true });

  // Issue new token
  const newRawToken = await createRefreshToken(stored.user_id);

  return { userId: stored.user_id, role: stored.role, newRawToken };
}

export async function revokeRefreshToken(rawToken: string): Promise<void> {
  const tokenHash = hashToken(rawToken);

  const count = await db('refresh_tokens')
    .where({ token_hash: tokenHash, revoked: false })
    .update({ revoked: true });

  if (count === 0) {
    throw Object.assign(new Error('Refresh token not found or already revoked'), {
      statusCode: 400,
    });
  }
}
