import { TicketSummary } from '../types';

interface TicketListProps {
  tickets: TicketSummary[];
  currentTab: string;
  onTabChange: (tab: string) => void;
  selectedTicketId: string | null;
  onSelectTicket: (ticket: TicketSummary) => void;
  loading: boolean;
  onRefresh: () => void;
}

export function formatBusinessTime(minutes: number, isLate: boolean, isMet: boolean): string {
  if (isMet) return 'Met';
  const abs = Math.abs(minutes);
  const hours = Math.floor(abs / 60);
  const mins = abs % 60;

  let formatted = '';
  if (hours >= 9) {
    const days = Math.floor(hours / 9);
    const remHours = hours % 9;
    formatted = `${days}d ${remHours}h`;
  } else {
    formatted = `${hours}h ${mins}m`;
  }

  if (isLate || minutes < 0) {
    return `Late by ${formatted}`;
  }
  return `${formatted} left`;
}

export function TicketList({
  tickets,
  currentTab,
  onTabChange,
  selectedTicketId,
  onSelectTicket,
  loading,
  onRefresh,
}: TicketListProps) {
  const tabs = [
    { id: 'mine', label: 'Mine' },
    { id: 'unassigned', label: 'Unassigned' },
    { id: 'late', label: 'Late' },
    { id: 'waiting', label: 'Waiting on Customer' },
    { id: 'open', label: 'All Open' },
    { id: 'all', label: 'All Tickets' },
  ];

  return (
    <div>
      <div className="tabs-container">
        <div className="tabs-list">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`tab-btn ${currentTab === tab.id ? 'active' : ''}`}
              onClick={() => onTabChange(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div>
          <button className="btn btn-sm btn-secondary" onClick={onRefresh} disabled={loading}>
            {loading ? 'Refreshing...' : '↻ Refresh'}
          </button>
        </div>
      </div>

      <div className="table-card">
        <table className="ticket-table">
          <thead>
            <tr>
              <th>Ticket</th>
              <th>Subject & Customer</th>
              <th>Priority</th>
              <th>Status</th>
              <th>Assignee</th>
              <th>Reply Due</th>
              <th>Resolve Due</th>
              <th>SLA Alerts</th>
            </tr>
          </thead>
          <tbody>
            {tickets.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                  {loading ? 'Loading tickets...' : 'No tickets match the selected view.'}
                </td>
              </tr>
            ) : (
              tickets.map((t) => {
                const isSelected = selectedTicketId === t.id;
                return (
                  <tr
                    key={t.id}
                    className={`ticket-row ${isSelected ? 'selected' : ''}`}
                    onClick={() => onSelectTicket(t)}
                  >
                    <td>
                      <strong style={{ color: '#1e3a8a' }}>{t.number}</strong>
                    </td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{t.subject}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        {t.customer_name} ({t.customer_email})
                      </div>
                    </td>
                    <td>
                      <span className={`badge badge-${t.priority}`}>{t.priority}</span>
                    </td>
                    <td>
                      <span className={`badge badge-${t.status}`}>
                        {t.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td>
                      {t.assignee_name ? (
                        <span style={{ fontWeight: 500 }}>{t.assignee_name}</span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
                          Unassigned
                        </span>
                      )}
                    </td>
                    <td>
                      <div style={{ fontWeight: 500 }}>
                        {formatBusinessTime(t.remainingReplyMinutes, t.isReplyLate, t.isReplyMet)}
                      </div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                        {new Date(t.deadlines.replyDeadline).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                    </td>
                    <td>
                      <div style={{ fontWeight: 500 }}>
                        {formatBusinessTime(t.remainingResolveMinutes, t.isResolveLate, t.isResolveMet)}
                      </div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                        {new Date(t.deadlines.resolveDeadline).toLocaleDateString([], {
                          month: 'short',
                          day: 'numeric',
                        })}{' '}
                        {new Date(t.deadlines.resolveDeadline).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                        {t.isLate && <span className="badge badge-late">LATE</span>}
                        {t.status === 'waiting_on_customer' && (
                          <span
                            className="badge badge-waiting-paused"
                            title="SLA clock paused while waiting on customer"
                          >
                            WAITING (PAUSED)
                          </span>
                        )}
                        {!t.isLate && t.status !== 'waiting_on_customer' && (
                          <span style={{ color: 'var(--success)', fontSize: '0.75rem', fontWeight: 600 }}>
                            ON TRACK
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
