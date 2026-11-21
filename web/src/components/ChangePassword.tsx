import { useState } from 'react';
import { api } from '../api';
import { User } from '../types';

interface ChangePasswordProps {
  user: User;
  onPasswordChanged: (updatedUser: User) => void;
}

/**
 * Force-change password screen shown when must_change_password is true.
 * The agent cannot access the workspace until they set a personal password.
 */
export function ChangePassword({ user, onPasswordChanged }: ChangePasswordProps) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (next !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    if (next.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }

    setLoading(true);
    try {
      await api.changePassword(current, next);
      // Update the in-memory user so the redirect works immediately
      onPasswordChanged({ ...user, mustChangePassword: false });
    } catch (err: any) {
      setError(err.message || 'Failed to change password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg)',
        padding: '1rem',
      }}
    >
      <div className="portal-card" style={{ maxWidth: '420px', width: '100%' }}>
        {/* Lock icon banner */}
        <div
          style={{
            background: 'var(--warning-bg, #fffbeb)',
            border: '1px solid #f59e0b',
            borderRadius: '8px',
            padding: '1rem',
            marginBottom: '1.5rem',
            display: 'flex',
            gap: '0.75rem',
            alignItems: 'flex-start',
          }}
        >
          <span style={{ fontSize: '1.5rem' }}>🔒</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.25rem' }}>
              Set your personal password
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Your account was set up with a temporary password. You must choose a new personal password before you can access the workspace. Your temporary password was given to you by your manager.
            </div>
          </div>
        </div>

        <div style={{ marginBottom: '1.25rem' }}>
          <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>Welcome, {user.name}</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{user.email}</div>
        </div>

        {error && <div className="alert alert-danger">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Temporary password (from your manager)</label>
            <input
              type="password"
              required
              className="form-control"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              placeholder="Enter the temporary password you were given"
              autoComplete="current-password"
            />
          </div>

          <div className="form-group">
            <label className="form-label">New password</label>
            <input
              type="password"
              required
              minLength={8}
              className="form-control"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              placeholder="At least 8 characters"
              autoComplete="new-password"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Confirm new password</label>
            <input
              type="password"
              required
              className="form-control"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Repeat your new password"
              autoComplete="new-password"
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%' }}
            disabled={loading}
          >
            {loading ? 'Saving…' : 'Set password and continue →'}
          </button>
        </form>
      </div>
    </div>
  );
}
