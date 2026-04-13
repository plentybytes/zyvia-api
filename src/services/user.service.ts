import { db } from '../db/connection.js';
import type { User, CreateUserInput, UserSummary } from '../models/user.js';

export async function createUser(input: CreateUserInput): Promise<User> {
  // Case-insensitive duplicate email check
  const existing = await db('users')
    .whereRaw('LOWER(email) = LOWER(?)', [input.email])
    .first();

  if (existing) {
    throw Object.assign(
      new Error(`A user with the email "${input.email}" already exists`),
      { statusCode: 409 },
    );
  }

  const [row] = await db('users')
    .insert({
      name: input.name,
      email: input.email,
      phone: input.phone ?? null,
      role: input.role,
    })
    .returning('*');

  return row as User;
}

export async function getUserById(id: string): Promise<User> {
  const row = await db('users').where({ id }).first();
  if (!row) {
    throw Object.assign(new Error('User not found'), { statusCode: 404 });
  }
  return row as User;
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const row = await db('users')
    .whereRaw('LOWER(email) = LOWER(?)', [email])
    .first();
  return row ? (row as User) : null;
}

export async function listUsers(): Promise<UserSummary[]> {
  const rows = await db('users')
    .select('id', 'name', 'email', 'role', 'created_at')
    .orderBy('created_at', 'desc');
  return rows as UserSummary[];
}
