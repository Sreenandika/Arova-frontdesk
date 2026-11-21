import { useState } from 'react';
import { api } from '../api';

interface PortalNewProps {
  onNavigate: (route: string) => void;
}

export function PortalNew({ onNavigate }: PortalNewProps) {
  const [severity, setSeverity] = useState<'critical' | 'medium' | 'low'>('medium');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdTicket, setCreatedTicket] = useState<any | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api.createPortalTicket({
        severity,
        subject,
        customer_name: name,
        customer_email: email,
        initial_message: message,
      });
      setCreatedTicket(res.ticket);
    } catch (err: any) {
      setError(err.message || 'Failed to submit ticket');
    } finally {
      setLoading(false);
    }
  };

  if (createdTicket) {
    const portalUrl = `/portal/t/${createdTicket.public_token}`;
    return (
      <div className="portal-card" style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🎉</div>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.5rem' }}>Ticket Created Successfully!</h2>
        <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
          Your ticket number is <strong>{createdTicket.number}</strong>.
        </p>

        <div className="alert alert-success" style={{ textAlign: 'left', wordBreak: 'break-all' }}>
          <strong>Bookmark your unique ticket link:</strong>
          <br />
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              onNavigate(portalUrl);
            }}
            style={{ fontWeight: 600, color: '#15803d' }}
          >
            {window.location.origin + portalUrl}
          </a>
        </div>

        <button className="btn btn-primary" style={{ marginTop: '1rem' }} onClick={() => onNavigate(portalUrl)}>
          View Your Ticket & Conversation →
        </button>
      </div>
    );
  }

  return (
    <div className="portal-card">
      <div style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.25rem' }}>Submit Support Request</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
          Arvo Systems Customer Helpdesk. No login required.
        </p>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label className="form-label">How urgent is this issue?</label>
          <div className="severity-options">
            <label
              className={`severity-label ${severity === 'critical' ? 'selected' : ''}`}
              onClick={() => setSeverity('critical')}
            >
              <input
                type="radio"
                name="severity"
                value="critical"
                checked={severity === 'critical'}
                onChange={() => setSeverity('critical')}
              />
              <div>
                <strong>I cannot work at all</strong> (Critical SLA: first reply in 2h, resolve today)
              </div>
            </label>

            <label
              className={`severity-label ${severity === 'medium' ? 'selected' : ''}`}
              onClick={() => setSeverity('medium')}
            >
              <input
                type="radio"
                name="severity"
                value="medium"
                checked={severity === 'medium'}
                onChange={() => setSeverity('medium')}
              />
              <div>
                <strong>Something is wrong but I can work</strong> (Medium SLA: first reply 4.5h, resolve 3 days)
              </div>
            </label>

            <label
              className={`severity-label ${severity === 'low' ? 'selected' : ''}`}
              onClick={() => setSeverity('low')}
            >
              <input
                type="radio"
                name="severity"
                value="low"
                checked={severity === 'low'}
                onChange={() => setSeverity('low')}
              />
              <div>
                <strong>Question or small request</strong> (Low SLA: first reply 9h, resolve 5 days)
              </div>
            </label>
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Your Name</label>
          <input
            type="text"
            required
            className="form-control"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ada Lovelace"
          />
        </div>

        <div className="form-group">
          <label className="form-label">Your Email</label>
          <input
            type="email"
            required
            className="form-control"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="ada@example.com"
          />
        </div>

        <div className="form-group">
          <label className="form-label">Subject</label>
          <input
            type="text"
            required
            className="form-control"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Brief summary of the issue..."
          />
        </div>

        <div className="form-group">
          <label className="form-label">Description / Details</label>
          <textarea
            required
            className="form-control"
            rows={4}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Describe what happened and any steps to reproduce..."
          />
        </div>

        <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={loading}>
          {loading ? 'Submitting request...' : 'Submit Support Ticket'}
        </button>
      </form>
    </div>
  );
}
