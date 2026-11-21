import { User } from '../types';

interface NavbarProps {
  user: User | null;
  onLogout: () => void;
  onNavigate: (route: string) => void;
  currentRoute: string;
}

export function Navbar({ user, onLogout, onNavigate, currentRoute }: NavbarProps) {
  return (
    <header className="navbar">
      <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
        <a
          href="#"
          className="brand"
          onClick={(e) => {
            e.preventDefault();
            onNavigate(user ? '/' : '/login');
          }}
        >
          <span>Frontdesk</span>
          <span className="brand-badge">Arvo Systems</span>
        </a>

        {user && (
          <nav style={{ display: 'flex', gap: '0.75rem' }}>
            <button
              className={`btn btn-sm ${currentRoute === '/' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => onNavigate('/')}
            >
              Agent Workspace
            </button>
            <a
              href="/api/tickets/export.csv"
              className="btn btn-sm btn-secondary"
              download="tickets-export.csv"
              title="Download ticket list as CSV (excludes internal notes)"
            >
              Export CSV
            </a>
          </nav>
        )}
      </div>

      <div className="nav-actions">
        <button
          className="btn btn-sm btn-secondary"
          onClick={() => onNavigate('/portal/new')}
        >
          Customer Portal
        </button>

        {user ? (
          <>
            <div className="user-badge">
              <span className="user-name">{user.name}</span> ({user.role})
            </div>
            <button className="btn btn-sm btn-secondary" onClick={onLogout}>
              Logout
            </button>
          </>
        ) : (
          <button className="btn btn-sm btn-primary" onClick={() => onNavigate('/login')}>
            Agent Login
          </button>
        )}
      </div>
    </header>
  );
}
