export type UserRole = 'patient' | 'provider' | 'administrator';

export interface User {
  id: string;
  email: string;
  password_hash: string;
  role: UserRole;
  account_status: 'active' | 'locked';
  failed_login_attempts: number;
  locked_until: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface UserPublic {
  id: string;
  email: string;
  role: UserRole;
  created_at: Date;
}
