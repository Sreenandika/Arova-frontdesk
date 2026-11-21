-- Migration 003: Staff onboarding — force password change on first login
-- A manager creates staff accounts; each staff member gets a one-time temp password
-- and is required to change it on first login.

ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
