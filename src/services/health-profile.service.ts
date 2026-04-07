import { db } from '../db/connection.js';
import type { HealthProfileWithBmi } from '../models/health-profile.js';

function computeBmi(weightKg: number, heightCm: number): number {
  const heightM = heightCm / 100;
  return Math.round((weightKg / (heightM * heightM)) * 100) / 100;
}

function computeAgeYears(dateOfBirth: string): number {
  const dob = new Date(dateOfBirth);
  const now = new Date();
  return Math.floor((now.getTime() - dob.getTime()) / (365.25 * 24 * 3600 * 1000));
}

function toProfileWithBmi(row: {
  id: string;
  user_id: string;
  date_of_birth: string;
  height_cm: number;
  weight_kg: number;
  created_at: Date;
  updated_at: Date;
}): HealthProfileWithBmi {
  const heightCm = Number(row.height_cm);
  const weightKg = Number(row.weight_kg);
  return {
    ...row,
    height_cm: heightCm,
    weight_kg: weightKg,
    age_years: computeAgeYears(row.date_of_birth),
    bmi: computeBmi(weightKg, heightCm),
  };
}

export async function getProfile(userId: string): Promise<HealthProfileWithBmi> {
  const row = await db('health_profiles').where({ user_id: userId }).first();
  if (!row) {
    throw Object.assign(new Error('Health profile not found for this user'), { statusCode: 404 });
  }
  return toProfileWithBmi(row);
}

export interface UpdateProfileInput {
  date_of_birth?: string;
  height_cm?: number;
  weight_kg?: number;
}

export async function updateProfile(
  userId: string,
  updates: UpdateProfileInput,
): Promise<HealthProfileWithBmi> {
  const updateData: Record<string, unknown> = { updated_at: db.fn.now() };
  if (updates.date_of_birth !== undefined) updateData.date_of_birth = updates.date_of_birth;
  if (updates.height_cm !== undefined) updateData.height_cm = updates.height_cm;
  if (updates.weight_kg !== undefined) updateData.weight_kg = updates.weight_kg;

  await db('health_profiles').where({ user_id: userId }).update(updateData);

  return getProfile(userId);
}
