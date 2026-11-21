import { useState, useEffect } from 'react';
import { api } from './api';
import { User, TicketSummary } from './types';
import { Navbar } from './components/Navbar';
import { Login } from './components/Login';
import { TicketList } from './components/TicketList';
import { TicketDetail } from './components/TicketDetail';
import { PortalNew } from './components/PortalNew';
import { PortalTicket } from './components/PortalTicket';

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    const saved = localStorage.getItem('frontdesk_user');
    return saved ? JSON.parse(saved) : null;
  });

  const [currentRoute, setCurrentRoute] = useState<string>(window.location.pathname);
  const [tickets, setTickets] = useState<TicketSummary[]>([]);
  const [currentTab, setCurrentTab] = useState<string>('all');
  const [selectedTicket, setSelectedTicket] = useState<TicketSummary | null>(null);
  const [loadingTickets, setLoadingTickets] = useState(false);

  // Synchronize route navigation
  const navigate = (route: string) => {
    window.history.pushState({}, '', route);
    setCurrentRoute(route);
  };

  useEffect(() => {
    const onPopState = () => {
      setCurrentRoute(window.location.pathname);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Fetch tickets for agent workspace
  const fetchTickets = async (tab = currentTab) => {
    if (!currentUser) return;
    setLoadingTickets(true);
    try {
      const res = await api.listTickets(tab);
      setTickets(res.tickets);
    } catch (err) {
      console.error('Error fetching tickets:', err);
    } finally {
      setLoadingTickets(false);
    }
  };

  useEffect(() => {
    if (currentUser && currentRoute === '/') {
      fetchTickets(currentTab);
    }
  }, [currentUser, currentTab, currentRoute]);

  const handleLogout = async () => {
    await api.logout();
    setCurrentUser(null);
    setSelectedTicket(null);
    navigate('/login');
  };

  const handleLoginSuccess = (user: User) => {
    setCurrentUser(user);
    navigate('/');
  };

  // Route matching
  if (currentRoute === '/portal/new') {
    return (
      <div className="app-container">
        <Navbar user={currentUser} onLogout={handleLogout} onNavigate={navigate} currentRoute={currentRoute} />
        <PortalNew onNavigate={navigate} />
      </div>
    );
  }

  if (currentRoute.startsWith('/portal/t/')) {
    const token = currentRoute.replace('/portal/t/', '');
    return (
      <div className="app-container">
        <Navbar user={currentUser} onLogout={handleLogout} onNavigate={navigate} currentRoute={currentRoute} />
        <PortalTicket token={token} onNavigate={navigate} />
      </div>
    );
  }

  if (!currentUser || currentRoute === '/login') {
    return (
      <div className="app-container">
        <Navbar user={null} onLogout={handleLogout} onNavigate={navigate} currentRoute={currentRoute} />
        <Login onLoginSuccess={handleLoginSuccess} onNavigate={navigate} />
      </div>
    );
  }

  return (
    <div className="app-container">
      <Navbar user={currentUser} onLogout={handleLogout} onNavigate={navigate} currentRoute={currentRoute} />

      <main className="main-layout">
        <div style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Agent Support Queue</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
              Real-time SLA tracking in Asia/Kolkata business hours (09:30 - 18:30 Mon-Fri)
            </p>
          </div>
          <div>
            <button
              className="btn btn-sm btn-secondary"
              onClick={() => navigate('/portal/new')}
            >
              + Submit Customer Ticket
            </button>
          </div>
        </div>

        <TicketList
          tickets={tickets}
          currentTab={currentTab}
          onTabChange={(tab) => {
            setCurrentTab(tab);
            setSelectedTicket(null);
          }}
          selectedTicketId={selectedTicket?.id || null}
          onSelectTicket={(ticket) => setSelectedTicket(ticket)}
          loading={loadingTickets}
          onRefresh={() => fetchTickets(currentTab)}
        />

        {selectedTicket && (
          <TicketDetail
            ticketId={selectedTicket.id}
            currentUser={currentUser}
            onClose={() => setSelectedTicket(null)}
            onUpdate={() => fetchTickets(currentTab)}
          />
        )}
      </main>
    </div>
  );
}
