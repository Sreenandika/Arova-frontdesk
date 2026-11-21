import { useState } from 'react';
import { api } from '../api';
import { User } from '../types';

interface LoginProps {
  onLoginSuccess: (user: User) => void;
  onNavigate: (route: string) => void;
}

export function Login({ onLoginSuccess, onNavigate }: LoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api.login(email, password);
      onLoginSuccess(res.user);
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickLogin = (demoEmail: string) => {
    setEmail(demoEmail);
    setPassword('password123');
  };

  return (
    <div className="portal-card" style={{ maxWidth: '420px', marginTop: '4rem' }}>
      <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.25rem' }}>Agent Sign In</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
          Arvo Systems Support Desk
        </p>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label className="form-label">Email address</label>
          <input
            type="email"
            required
            className="form-control"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="agent@arvo.test"
          />
        </div>

        <div className="form-group">
          <label className="form-label">Password</label>
          <input
            type="password"
            required
            className="form-control"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </div>

        <button type="submit" className="btn btn-primary" style={{ width: '100%', marginBottom: '1.5rem' }} disabled={loading}>
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
      </form>

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
        <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
          DEMO LOGINS (Password: password123)
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            style={{ justifyContent: 'flex-start' }}
            onClick={() => handleQuickLogin('agent1@arvo.test')}
          >
            👤 <strong>Aarav Sharma</strong> (Agent 1)
          </button>
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            style={{ justifyContent: 'flex-start' }}
            onClick={() => handleQuickLogin('agent2@arvo.test')}
          >
            👤 <strong>Diya Patel</strong> (Agent 2)
          </button>
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            style={{ justifyContent: 'flex-start' }}
            onClick={() => handleQuickLogin('manager@arvo.test')}
          >
            🛡️ <strong>Vikram Rao</strong> (Manager)
          </button>
        </div>
      </div>

      <div style={{ textAlign: 'center', marginTop: '1.5rem' }}>
        <button
          type="button"
          style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontSize: '0.875rem' }}
          onClick={() => onNavigate('/portal/new')}
        >
          Need to submit a customer ticket? Go to Customer Portal →
        </button>
      </div>
    </div>
  );
}
