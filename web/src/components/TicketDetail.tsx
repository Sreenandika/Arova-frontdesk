import { useState, useEffect } from 'react';
import { api } from '../api';
import { TicketDetailData, User, TicketPriority, TicketStatus } from '../types';

interface TicketDetailProps {
  ticketId: string;
  currentUser: User;
  onClose: () => void;
  onUpdate: () => void;
}

export function TicketDetail({ ticketId, currentUser, onClose, onUpdate }: TicketDetailProps) {
  const [data, setData] = useState<TicketDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<'conversation' | 'audit'>('conversation');
  const [replyText, setReplyText] = useState('');
  const [noteText, setNoteText] = useState('');
  const [submittingReply, setSubmittingReply] = useState(false);
  const [submittingNote, setSubmittingNote] = useState(false);

  const [verificationResult, setVerificationResult] = useState<{
    valid: boolean;
    totalEvents: number;
    brokenEventId?: string;
    reason?: string;
  } | null>(null);
  const [verifying, setVerifying] = useState(false);

  const loadTicket = async () => {
    try {
      setLoading(true);
      setError(null);
      const detail = await api.getTicket(ticketId);
      setData(detail);
    } catch (err: any) {
      setError(err.message || 'Failed to load ticket details');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTicket();
  }, [ticketId]);

  if (loading && !data) {
    return <div className="card" style={{ padding: '3rem', textAlign: 'center' }}>Loading ticket details...</div>;
  }

  if (!data) {
    return <div className="card alert alert-danger">{error || 'Ticket not found'}</div>;
  }

  const { ticket, messages, notes, events, deadlines, canReopen } = data;
  const isAssignedToMe = ticket.assignee_id === currentUser.id;
  const isUnassigned = !ticket.assignee_id;

  // Combine messages and notes chronologically for conversation view
  type ThreadItem =
    | { type: 'message'; data: (typeof messages)[0]; created_at: string }
    | { type: 'note'; data: (typeof notes)[0]; created_at: string };

  const threadItems: ThreadItem[] = [
    ...messages.map((m) => ({ type: 'message' as const, data: m, created_at: m.created_at })),
    ...notes.map((n) => ({ type: 'note' as const, data: n, created_at: n.created_at })),
  ].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  const handleClaim = async () => {
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await api.claimTicket(ticket.id);
      if (res.success) {
        setSuccessMsg('You have successfully claimed this ticket.');
        await loadTicket();
        onUpdate();
      }
    } catch (err: any) {
      if (err.status === 409) {
        const holder = err.data?.heldBy || 'another agent';
        const since = err.data?.heldSince ? ` since ${new Date(err.data.heldSince).toLocaleTimeString()}` : '';
        setError(`Conflict (INC-0291): Already taken by ${holder}${since}.`);
      } else {
        setError(err.message || 'Failed to claim ticket');
      }
      await loadTicket();
    }
  };

  const handleRelease = async () => {
    setError(null);
    try {
      await api.releaseTicket(ticket.id);
      setSuccessMsg('Ticket released to the unassigned queue.');
      await loadTicket();
      onUpdate();
    } catch (err: any) {
      setError(err.message || 'Failed to release ticket');
    }
  };

  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyText.trim()) return;
    setError(null);
    setSuccessMsg(null);
    setSubmittingReply(true);
    try {
      await api.sendReply(ticket.id, replyText);
      setReplyText('');
      setSuccessMsg('Public reply sent to customer.');
      await loadTicket();
      onUpdate();
    } catch (err: any) {
      setError(err.message || 'Failed to send reply');
    } finally {
      setSubmittingReply(false);
    }
  };

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteText.trim()) return;
    setError(null);
    setSuccessMsg(null);
    setSubmittingNote(true);
    try {
      await api.addNote(ticket.id, noteText);
      setNoteText('');
      setSuccessMsg('Private internal note saved (strictly hidden from customer).');
      await loadTicket();
      onUpdate();
    } catch (err: any) {
      setError(err.message || 'Failed to add note');
    } finally {
      setSubmittingNote(false);
    }
  };

  const handleStatusChange = async (newStatus: TicketStatus) => {
    setError(null);
    try {
      await api.updateStatus(ticket.id, newStatus);
      setSuccessMsg(`Status updated to ${newStatus.replace(/_/g, ' ')}`);
      await loadTicket();
      onUpdate();
    } catch (err: any) {
      setError(err.message || 'Failed to update status');
    }
  };

  const handlePriorityChange = async (newPriority: TicketPriority) => {
    setError(null);
    try {
      await api.updatePriority(ticket.id, newPriority);
      setSuccessMsg(`Priority updated to ${newPriority}. Deadlines recalculated from start time.`);
      await loadTicket();
      onUpdate();
    } catch (err: any) {
      setError(err.message || 'Failed to update priority');
    }
  };

  const handleReopen = async () => {
    setError(null);
    try {
      await api.reopenTicket(ticket.id);
      setSuccessMsg('Ticket reopened successfully. SLA clock restarted.');
      await loadTicket();
      onUpdate();
    } catch (err: any) {
      setError(err.message || 'Failed to reopen ticket');
    }
  };

  const handleVerifyAudit = async () => {
    setVerifying(true);
    try {
      const res = await api.verifyAudit(ticket.id);
      setVerificationResult(res);
    } catch (err: any) {
      setError(err.message || 'Failed to verify audit chain');
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div style={{ marginTop: '1.5rem' }}>
      <div className="card">
        {/* Header */}
        <div className="detail-header">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
              <span style={{ fontSize: '1.25rem', fontWeight: 800, color: '#1e3a8a' }}>{ticket.number}</span>
              <span className={`badge badge-${ticket.priority}`}>{ticket.priority}</span>
              <span className={`badge badge-${ticket.status}`}>{ticket.status.replace(/_/g, ' ')}</span>
              {data.isLate && <span className="badge badge-late">LATE</span>}
              {ticket.status === 'waiting_on_customer' && (
                <span className="badge badge-waiting-paused">Clock Paused</span>
              )}
            </div>
            <h2 className="ticket-title">{ticket.subject}</h2>
            <div className="ticket-meta">
              Customer: <strong>{ticket.customer_name}</strong> ({ticket.customer_email}) &bull; Created:{' '}
              {new Date(ticket.created_at).toLocaleString()}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {isUnassigned ? (
              <button className="btn btn-primary" onClick={handleClaim}>
                ✋ Take this ticket
              </button>
            ) : isAssignedToMe ? (
              <button className="btn btn-secondary" onClick={handleRelease}>
                Release Ticket
              </button>
            ) : currentUser.role === 'manager' ? (
              <button className="btn btn-secondary" onClick={handleClaim}>
                Reassign to Me
              </button>
            ) : (
              <span className="badge badge-waiting">Assigned to {ticket.assignee_name}</span>
            )}

            <button className="btn btn-secondary" onClick={onClose}>
              ✕ Close
            </button>
          </div>
        </div>

        {error && <div className="alert alert-danger">{error}</div>}
        {successMsg && <div className="alert alert-success">{successMsg}</div>}

        {/* View Tabs */}
        <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid var(--border)', marginBottom: '1.25rem' }}>
          <button
            className={`tab-btn ${activeTab === 'conversation' ? 'active' : ''}`}
            onClick={() => setActiveTab('conversation')}
          >
            💬 Conversation & Notes ({threadItems.length})
          </button>
          <button
            className={`tab-btn ${activeTab === 'audit' ? 'active' : ''}`}
            onClick={() => setActiveTab('audit')}
          >
            🛡️ Activity & Hash Audit Log ({events.length})
          </button>
        </div>

        {activeTab === 'conversation' ? (
          <div className="detail-layout">
            <div>
              {/* Thread */}
              <div className="thread-container">
                {threadItems.map((item, idx) => {
                  if (item.type === 'message') {
                    const isAgent = item.data.sender_type === 'agent';
                    return (
                      <div key={idx} className={`message-bubble ${isAgent ? 'agent' : 'customer'}`}>
                        <div className="message-header">
                          <span>
                            {isAgent ? `👤 Support Agent (${item.data.sender_name})` : `👤 Customer (${item.data.sender_name})`}
                          </span>
                          <span>{new Date(item.created_at).toLocaleString()}</span>
                        </div>
                        <div className="message-body">{item.data.message}</div>
                      </div>
                    );
                  } else {
                    return (
                      <div key={idx} className="message-bubble internal-note">
                        <div className="message-header">
                          <span style={{ color: '#b45309' }}>
                            🔒 <strong>TEAM-ONLY NOTE</strong> ({item.data.author_name})
                          </span>
                          <span>{new Date(item.created_at).toLocaleString()}</span>
                        </div>
                        <div className="message-body">{item.data.note}</div>
                      </div>
                    );
                  }
                })}
              </div>

              {/* Public Reply Box */}
              <div className="action-box reply-box">
                <div className="action-title">
                  <span>✉️ Reply to customer (visible to customer)</span>
                </div>
                {!isAssignedToMe && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--danger)', marginBottom: '0.5rem', fontWeight: 600 }}>
                    ⚠️ Only the current assignee may send a public reply. You must take this ticket first.
                  </div>
                )}
                <form onSubmit={handleSendReply}>
                  <textarea
                    className="form-control"
                    placeholder="Type your customer-visible response here..."
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    disabled={!isAssignedToMe || submittingReply}
                  />
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      type="submit"
                      className="btn btn-primary btn-sm"
                      disabled={!isAssignedToMe || !replyText.trim() || submittingReply}
                    >
                      {submittingReply ? 'Sending...' : 'Send Public Reply'}
                    </button>
                  </div>
                </form>
              </div>

              {/* Separate Yellow Internal Note Box */}
              <div className="action-box note-box">
                <div className="action-title note-title">
                  <span>🔒 Team-only note, customer can never see this</span>
                </div>
                <div style={{ fontSize: '0.75rem', color: '#b45309', marginBottom: '0.5rem' }}>
                  Stored in a separate internal database table. Structurally excluded from customer portals and exports.
                </div>
                <form onSubmit={handleAddNote}>
                  <textarea
                    className="form-control"
                    style={{ borderColor: 'var(--warning-border)', background: '#fff' }}
                    placeholder="Write private internal notes, technical investigation, or handoff comments..."
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    disabled={submittingNote}
                  />
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      type="submit"
                      className="btn btn-sm"
                      style={{ background: '#d97706', color: '#ffffff' }}
                      disabled={!noteText.trim() || submittingNote}
                    >
                      {submittingNote ? 'Saving note...' : 'Add Team Note'}
                    </button>
                  </div>
                </form>
              </div>
            </div>

            {/* Sidebar Controls */}
            <div>
              <div className="sidebar-section">
                <div className="sidebar-title">Status Management</div>
                <select
                  className="form-control"
                  value={ticket.status}
                  onChange={(e) => handleStatusChange(e.target.value as TicketStatus)}
                  disabled={!isAssignedToMe && currentUser.role !== 'manager'}
                >
                  <option value="open">Open</option>
                  <option value="waiting_on_customer">Waiting on Customer (Clock Pauses)</option>
                  <option value="resolved">Resolved</option>
                  <option value="closed">Closed</option>
                </select>
                {ticket.status === 'resolved' && canReopen && (
                  <button
                    className="btn btn-sm btn-secondary"
                    style={{ marginTop: '0.5rem', width: '100%' }}
                    onClick={handleReopen}
                  >
                    ↺ Reopen Ticket
                  </button>
                )}
              </div>

              <div className="sidebar-section">
                <div className="sidebar-title">Priority & SLA Targets</div>
                <select
                  className="form-control"
                  value={ticket.priority}
                  onChange={(e) => handlePriorityChange(e.target.value as TicketPriority)}
                >
                  <option value="critical">Critical (Reply: 2h, Resolve: End of Day)</option>
                  <option value="medium">Medium (Reply: 4.5h, Resolve: 3 days)</option>
                  <option value="low">Low (Reply: 9h, Resolve: 5 days)</option>
                </select>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.4rem' }}>
                  Priority changes trigger an audit recalculation of deadlines from ticket start.
                </div>
              </div>

              <div className="sidebar-section card" style={{ background: '#f8fafc' }}>
                <div className="sidebar-title">SLA Deadlines</div>
                <div style={{ marginBottom: '0.75rem' }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600 }}>First Reply Due:</div>
                  <div style={{ fontSize: '0.875rem' }}>
                    {new Date(deadlines.replyDeadline).toLocaleString()}
                  </div>
                  {ticket.first_response_at && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--success)', fontWeight: 600 }}>
                      ✓ Met: {new Date(ticket.first_response_at).toLocaleString()}
                    </div>
                  )}
                </div>

                <div>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600 }}>Resolution Due:</div>
                  <div style={{ fontSize: '0.875rem' }}>
                    {new Date(deadlines.resolveDeadline).toLocaleString()}
                  </div>
                  {ticket.resolved_at && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--success)', fontWeight: 600 }}>
                      ✓ Resolved: {new Date(ticket.resolved_at).toLocaleString()}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* Audit Log Tab */
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div>
                <h3 style={{ fontSize: '1rem', fontWeight: 700 }}>Cryptographic Audit Chain (INC-0318)</h3>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  Append-only event store with SHA-256 hash chaining and PostgreSQL triggers blocking modification.
                </p>
              </div>
              <button className="btn btn-sm btn-primary" onClick={handleVerifyAudit} disabled={verifying}>
                {verifying ? 'Verifying hashes...' : '🔍 Verify Hash Integrity'}
              </button>
            </div>

            {verificationResult && (
              <div
                className={`alert ${verificationResult.valid ? 'alert-success' : 'alert-danger'}`}
                style={{ marginBottom: '1rem' }}
              >
                {verificationResult.valid ? (
                  <div>
                    <strong>✓ Audit Integrity Verified:</strong> All {verificationResult.totalEvents} events have unbroken
                    cryptographic hash links and match server signatures.
                  </div>
                ) : (
                  <div>
                    <strong>✕ Tampering Detected!</strong> Chain compromised at event ID:{' '}
                    <code>{verificationResult.brokenEventId}</code>. Reason: {verificationResult.reason}
                  </div>
                )}
              </div>
            )}

            <div className="table-card">
              <table className="audit-table">
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Event Type</th>
                    <th>Actor</th>
                    <th>Payload Details</th>
                    <th>SHA-256 Hash</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((ev) => (
                    <tr key={ev.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {new Date(ev.created_at).toLocaleString()}
                      </td>
                      <td>
                        <strong>{ev.type}</strong>
                      </td>
                      <td>
                        <span className="badge badge-waiting">
                          {ev.actor_type}
                        </span>
                      </td>
                      <td>
                        <code>{JSON.stringify(ev.payload)}</code>
                      </td>
                      <td>
                        <code title={ev.hash}>{ev.hash.substring(0, 12)}...</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
