import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { pool } from '../db/pool.js';
import { hashPassword } from './auth.service.js';

export interface StaffMember {
  id: string;
  name: string;
  email: string;
  role: 'agent' | 'manager';
  must_change_password: boolean;
  created_at: string;
}

/** Generate a human-readable one-time temp password like "Hawk-7392-Dusk" */
function generateTempPassword(): string {
  const adjectives = ['Swift', 'Brave', 'Calm', 'Dusk', 'Fern', 'Gold', 'Haze', 'Iris', 'Jade', 'Lark'];
  const nouns = ['Hawk', 'Wolf', 'Sage', 'Reed', 'Peak', 'Vale', 'Tide', 'Glen', 'Mist', 'Dawn'];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const num = Math.floor(1000 + Math.random() * 9000);
  return `${noun}-${num}-${adj}`;
}

/**
 * Manager creates a new staff account.
 * Returns the plaintext temp password (shown ONCE — never stored in plain text).
 */
export async function createStaffMember(
  name: string,
  email: string,
  role: 'agent' | 'manager'
): Promise<{ member: StaffMember; tempPassword: string }> {
  const normalizedEmail = email.toLowerCase().trim();

  // Check for duplicate email
  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
  if (existing.rows.length > 0) {
    throw new Error('A user with this email address already exists.');
  }

  const tempPassword = generateTempPassword();
  const hash = await hashPassword(tempPassword);

  const { rows } = await pool.query(
    `INSERT INTO users (name, email, password_hash, role, must_change_password)
     VALUES ($1, $2, $3, $4, TRUE)
     RETURNING id, name, email, role, must_change_password, created_at`,
    [name.trim(), normalizedEmail, hash, role]
  );

  return { member: rows[0], tempPassword };
}

/** List all staff (manager view) */
export async function listStaff(): Promise<StaffMember[]> {
  const { rows } = await pool.query(
    `SELECT id, name, email, role, must_change_password, created_at
     FROM users
     ORDER BY role DESC, name ASC`
  );
  return rows;
}

/** Change own password. Clears must_change_password flag. */
export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string
): Promise<void> {
  const { rows } = await pool.query(
    'SELECT password_hash FROM users WHERE id = $1',
    [userId]
  );
  if (rows.length === 0) throw new Error('User not found.');

  const valid = await bcrypt.compare(currentPassword, rows[0].password_hash);
  if (!valid) throw new Error('Current password is incorrect.');

  if (newPassword.length < 8) throw new Error('New password must be at least 8 characters.');
  if (newPassword === currentPassword) throw new Error('New password must differ from your current password.');

  const newHash = await hashPassword(newPassword);
  await pool.query(
    'UPDATE users SET password_hash = $1, must_change_password = FALSE WHERE id = $2',
    [newHash, userId]
  );
}

/** Manager resets another user's password back to a new temp password. */
export async function resetStaffPassword(
  targetUserId: string
): Promise<{ tempPassword: string }> {
  const { rows } = await pool.query('SELECT id FROM users WHERE id = $1', [targetUserId]);
  if (rows.length === 0) throw new Error('User not found.');

  const tempPassword = generateTempPassword();
  const hash = await hashPassword(tempPassword);

  await pool.query(
    'UPDATE users SET password_hash = $1, must_change_password = TRUE WHERE id = $2',
    [hash, targetUserId]
  );

  return { tempPassword };
}
