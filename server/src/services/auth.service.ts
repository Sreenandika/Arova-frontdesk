import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../db/pool.js';
import { config } from '../config.js';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: 'agent' | 'manager';
  mustChangePassword?: boolean;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function generateToken(user: AuthUser): string {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      mustChangePassword: user.mustChangePassword ?? false,
    },
    config.jwtSecret,
    { expiresIn: '7d' }
  );
}

export function verifyToken(token: string): AuthUser {
  return jwt.verify(token, config.jwtSecret) as AuthUser;
}

export async function loginUser(email: string, password: string): Promise<{ user: AuthUser; token: string }> {
  const { rows } = await pool.query(
    'SELECT id, name, email, password_hash, role, must_change_password FROM users WHERE email = $1',
    [email.toLowerCase().trim()]
  );

  if (rows.length === 0) {
    throw new Error('Invalid email or password');
  }

  const dbUser = rows[0];
  const valid = await comparePassword(password, dbUser.password_hash);
  if (!valid) {
    throw new Error('Invalid email or password');
  }

  const user: AuthUser = {
    id: dbUser.id,
    name: dbUser.name,
    email: dbUser.email,
    role: dbUser.role,
    mustChangePassword: dbUser.must_change_password,
  };

  const token = generateToken(user);
  return { user, token };
}

export async function getUserById(id: string): Promise<AuthUser | null> {
  const { rows } = await pool.query(
    'SELECT id, name, email, role FROM users WHERE id = $1',
    [id]
  );
  if (rows.length === 0) return null;
  return rows[0];
}
