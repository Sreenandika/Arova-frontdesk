import { useState, useEffect } from 'react';
import { api } from '../api';
import { StaffMember } from '../types';

/**
 * Manager-only screen: view the team, create new staff accounts, reset passwords.
 */
export function StaffManagement() {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<'agent' | 'manager'>('agent');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [newCredentials, setNewCredentials] = useState<{ name: string; email: string; tempPassword: string } | null>(null);

  // Reset password
  const [resetting, setResetting] = useState<string | null>(null);
  const [resetCredentials, setResetCredentials] = useState<{ name: string; tempPassword: string } | null>(null);

  const loadStaff = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listStaff();
      setStaff(res.staff);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStaff();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    setCreating(true);
    try {
      const res = await api.createStaff({ name: newName, email: newEmail, role: newRole });
      setNewCredentials({ name: res.member.name, email: res.member.email, tempPassword: res.tempPassword });
      setNewName('');
      setNewEmail('');
      setNewRole('agent');
      setShowCreate(false);
      await loadStaff();
    } catch (err: any) {
      setCreateError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const handleResetPassword = async (member: StaffMember) => {
    if (!confirm(`Reset the password for ${member.name}? They will get a new temporary password and must change it on next login.`)) return;
    setResetting(member.id);
    try {
      const res = await api.resetStaffPassword(member.id);
      setResetCredentials({ name: member.name, tempPassword: res.tempPassword });
    } catch (err: any) {
      alert('Reset failed: ' + err.message);
    } finally {
      setResetting(null);
    }
  };

  return (
    <div style={{ padding: '1.5rem', maxWidth: '900px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 700, marginBottom: '0.25rem' }}>Team Management</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
            Create staff accounts and manage access. New agents receive a temporary password that they must change on first login.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => { setShowCreate(true); setNewCredentials(null); setCreateError(null); }}>
          + Add Staff Member
        </button>
      </div>

      {/* New credentials banner — shown after creating or resetting */}
      {newCredentials && (
        <div style={{ background: '#f0fdf4', border: '1px solid #16a34a', borderRadius: '8px', padding: '1rem 1.25rem', marginBottom: '1.5rem' }}>
          <div style={{ fontWeight: 700, color: '#15803d', marginBottom: '0.5rem' }}>
            ✅ Account created for {newCredentials.name}
          </div>
          <div style={{ fontSize: '0.875rem', marginBottom: '0.75rem', color: '#166534' }}>
            Share these credentials securely (e.g. via a direct message). The temporary password is shown <strong>only once</strong>.
          </div>
          <div style={{ background: 'white', borderRadius: '6px', padding: '0.75rem 1rem', fontFamily: 'monospace', fontSize: '0.9rem' }}>
            <div><strong>Email:</strong> {newCredentials.email}</div>
            <div><strong>Temporary password:</strong> <span style={{ color: '#dc2626', fontWeight: 700 }}>{newCredentials.tempPassword}</span></div>
          </div>
          <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.5rem' }}>
            The agent will be forced to set a personal password before they can access the workspace.
          </div>
          <button
            style={{ marginTop: '0.75rem', background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: '0.8rem', textDecoration: 'underline' }}
            onClick={() => setNewCredentials(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {resetCredentials && (
        <div style={{ background: '#fffbeb', border: '1px solid #f59e0b', borderRadius: '8px', padding: '1rem 1.25rem', marginBottom: '1.5rem' }}>
          <div style={{ fontWeight: 700, color: '#92400e', marginBottom: '0.5rem' }}>
            🔑 Password reset for {resetCredentials.name}
          </div>
          <div style={{ background: 'white', borderRadius: '6px', padding: '0.75rem 1rem', fontFamily: 'monospace', fontSize: '0.9rem' }}>
            <div><strong>New temporary password:</strong> <span style={{ color: '#dc2626', fontWeight: 700 }}>{resetCredentials.tempPassword}</span></div>
          </div>
          <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.5rem' }}>
            Share this securely. It will not be shown again.
          </div>
          <button
            style={{ marginTop: '0.75rem', background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: '0.8rem', textDecoration: 'underline' }}
            onClick={() => setResetCredentials(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Create staff form */}
      {showCreate && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', padding: '1.25rem', marginBottom: '1.5rem' }}>
          <h3 style={{ fontWeight: 700, marginBottom: '1rem', fontSize: '1rem' }}>New Staff Account</h3>
          {createError && <div className="alert alert-danger">{createError}</div>}
          <form onSubmit={handleCreate} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">Full name</label>
              <input
                type="text"
                required
                className="form-control"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Priya Nair"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Work email</label>
              <input
                type="email"
                required
                className="form-control"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="priya@arvo.com"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Role</label>
              <select
                className="form-control"
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as 'agent' | 'manager')}
              >
                <option value="agent">Support Agent</option>
                <option value="manager">Manager</option>
              </select>
            </div>
            <div className="form-group" style={{ display: 'flex', alignItems: 'flex-end', gap: '0.5rem' }}>
              <button type="submit" className="btn btn-primary" disabled={creating} style={{ flex: 1 }}>
                {creating ? 'Creating…' : 'Create Account'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setShowCreate(false)}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Staff table */}
      {loading ? (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>Loading team…</div>
      ) : error ? (
        <div className="alert alert-danger">{error}</div>
      ) : (
        <div style={{ border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Name</th>
                <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Email</th>
                <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Role</th>
                <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Status</th>
                <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {staff.map((member, i) => (
                <tr
                  key={member.id}
                  style={{
                    borderBottom: i < staff.length - 1 ? '1px solid var(--border)' : 'none',
                    background: 'white',
                  }}
                >
                  <td style={{ padding: '0.75rem 1rem', fontWeight: 600, fontSize: '0.875rem' }}>{member.name}</td>
                  <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem', color: 'var(--text-muted)' }}>{member.email}</td>
                  <td style={{ padding: '0.75rem 1rem' }}>
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '0.15rem 0.5rem',
                        borderRadius: '4px',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        background: member.role === 'manager' ? '#dbeafe' : '#f3f4f6',
                        color: member.role === 'manager' ? '#1d4ed8' : '#374151',
                      }}
                    >
                      {member.role === 'manager' ? 'Manager' : 'Agent'}
                    </span>
                  </td>
                  <td style={{ padding: '0.75rem 1rem' }}>
                    {member.must_change_password ? (
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '0.15rem 0.5rem',
                          borderRadius: '4px',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          background: '#fef9c3',
                          color: '#854d0e',
                        }}
                      >
                        ⚠ Temp password active
                      </span>
                    ) : (
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Active</span>
                    )}
                  </td>
                  <td style={{ padding: '0.75rem 1rem' }}>
                    <button
                      className="btn btn-sm btn-secondary"
                      onClick={() => handleResetPassword(member)}
                      disabled={resetting === member.id}
                    >
                      {resetting === member.id ? 'Resetting…' : 'Reset password'}
                    </button>
                  </td>
                </tr>
              ))}
              {staff.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                    No staff members yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
