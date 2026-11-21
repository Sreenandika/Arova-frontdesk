import { useState, useEffect } from 'react';
import { api } from '../api';

interface PortalTicketProps {
  token: string;
  onNavigate: (route: string) => void;
}

export function PortalTicket({ token, onNavigate }: PortalTicketProps) {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [submittingReply, setSubmittingReply] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const loadTicket = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.getPortalTicket(token);
      setData(res);
    } catch (err: any) {
      setError(err.message || 'Ticket not found');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTicket();
  }, [token]);

  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyText.trim()) return;
    setError(null);
    setActionMsg(null);
    setSubmittingReply(true);
    try {
      await api.portalReply(token, replyText);
      setReplyText('');
      setActionMsg('Your reply was submitted. The support team has been notified.');
      await loadTicket();
    } catch (err: any) {
      setError(err.message || 'Failed to submit reply');
    } finally {
      setSubmittingReply(false);
    }
  };

  const handleReopen = async () => {
    setError(null);
    setActionMsg(null);
    try {
      const res = await api.portalReopen(token);
      if (res.reopened) {
        setActionMsg('Ticket reopened successfully. Our agents are resuming work.');
        await loadTicket();
      } else if (res.newTicket) {
        setActionMsg(
          `The 5-day reopen window expired. A follow-up linked ticket (${res.newTicket.number}) was created for you!`
        );
        onNavigate(`/portal/t/${res.newTicket.public_token}`);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to reopen ticket');
    }
  };

  if (loading && !data) {
    return <div className="portal-card" style={{ textAlign: 'center' }}>Loading your ticket conversation...</div>;
  }

  if (!data) {
    return (
      <div className="portal-card alert alert-danger">
        {error || 'Unable to find this ticket. Please check your unique link.'}
      </div>
    );
  }

  const { ticket, messages, canReopen } = data;

  return (
    <div className="main-layout" style={{ maxWidth: '850px' }}>
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
              <span style={{ fontSize: '1.25rem', fontWeight: 800, color: '#1e3a8a' }}>{ticket.number}</span>
              <span className={`badge badge-${ticket.priority}`}>{ticket.priority}</span>
              <span className={`badge badge-${ticket.status}`}>{ticket.status.replace(/_/g, ' ')}</span>
            </div>
            <h1 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.25rem' }}>{ticket.subject}</h1>
            <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
              Submitted on {new Date(ticket.created_at).toLocaleString()} by {ticket.customer_name}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <a
              href={`/api/portal/tickets/${token}/export`}
              download={`${ticket.number}-transcript.txt`}
              className="btn btn-sm btn-secondary"
            >
              📥 Download Transcript
            </a>

            {ticket.status === 'resolved' && (
              canReopen ? (
                <button className="btn btn-sm btn-primary" onClick={handleReopen}>
                  ↺ Reopen Ticket
                </button>
              ) : (
                <button
                  className="btn btn-sm btn-secondary"
                  onClick={handleReopen}
                  title="5 working days elapsed; creates a new linked ticket"
                >
                  Create Follow-up Ticket
                </button>
              )
            )}
          </div>
        </div>

        {error && <div className="alert alert-danger" style={{ marginTop: '1rem' }}>{error}</div>}
        {actionMsg && <div className="alert alert-success" style={{ marginTop: '1rem' }}>{actionMsg}</div>}
      </div>

      {/* Messages Thread */}
      <div className="thread-container" style={{ maxHeight: 'none', marginBottom: '1.5rem' }}>
        {messages.map((m: any) => {
          const isAgent = m.sender_type === 'agent';
          return (
            <div key={m.id} className={`message-bubble ${isAgent ? 'agent' : 'customer'}`}>
              <div className="message-header">
                <span>{isAgent ? `👤 Support Agent (${m.sender_name})` : `👤 You (${m.sender_name})`}</span>
                <span>{new Date(m.created_at).toLocaleString()}</span>
              </div>
              <div className="message-body">{m.message}</div>
            </div>
          );
        })}
      </div>

      {/* Customer Reply Box */}
      {ticket.status !== 'closed' ? (
        <div className="card">
          <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.5rem' }}>Reply to Arvo Support</h3>
          {ticket.status === 'waiting_on_customer' && (
            <div className="alert alert-warning" style={{ fontSize: '0.8rem', padding: '0.5rem 0.75rem' }}>
              💡 We are currently waiting for your reply. Replying here will automatically resume the SLA clock and reopen the ticket for our agents.
            </div>
          )}
          <form onSubmit={handleSendReply}>
            <textarea
              className="form-control"
              rows={3}
              placeholder="Add more information or follow-up response..."
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              disabled={submittingReply}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={!replyText.trim() || submittingReply}
              >
                {submittingReply ? 'Sending reply...' : 'Send Message'}
              </button>
            </div>
          </form>
        </div>
      ) : (
        <div className="alert alert-warning" style={{ textAlign: 'center' }}>
          This ticket has been closed. If you need further assistance, please{' '}
          <button
            style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontWeight: 600 }}
            onClick={() => onNavigate('/portal/new')}
          >
            open a new support ticket
          </button>
          .
        </div>
      )}
    </div>
  );
}
