export type UserRole = 'patient' | 'provider' | 'administrator';

export interface User {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: UserRole;
  created_at: Date;
  updated_at: Date;
}

export interface CreateUserInput {
  name: string;
  email: string;
  phone?: string;
  role: UserRole;
}

export interface UserSummary {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  created_at: Date;
}
