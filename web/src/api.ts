import { User, TicketSummary, TicketDetailData, TicketPriority, TicketStatus } from './types';

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('frontdesk_token');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(url, { ...options, headers });

  if (response.status === 401 && !url.includes('/api/auth/login')) {
    localStorage.removeItem('frontdesk_token');
    localStorage.removeItem('frontdesk_user');
    window.location.href = '/login';
    throw new Error('Session expired. Please log in again.');
  }

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const err = new Error(errorBody.error || `Request failed with status ${response.status}`);
    (err as any).status = response.status;
    (err as any).data = errorBody;
    throw err;
  }

  return response.json();
}

export const api = {
  // Auth
  async login(email: string, password: string): Promise<{ user: User; token: string }> {
    const res = await request<{ user: User; token: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    localStorage.setItem('frontdesk_token', res.token);
    localStorage.setItem('frontdesk_user', JSON.stringify(res.user));
    return res;
  },

  async logout(): Promise<void> {
    await request('/api/auth/logout', { method: 'POST' }).catch(() => {});
    localStorage.removeItem('frontdesk_token');
    localStorage.removeItem('frontdesk_user');
  },

  async getMe(): Promise<{ user: User }> {
    return request<{ user: User }>('/api/me');
  },

  // Tickets
  async listTickets(tab: string = 'all'): Promise<{ tickets: TicketSummary[] }> {
    return request<{ tickets: TicketSummary[] }>(`/api/tickets?tab=${tab}`);
  },

  async getTicket(id: string): Promise<TicketDetailData> {
    return request<TicketDetailData>(`/api/tickets/${id}`);
  },

  async claimTicket(id: string): Promise<{ success: boolean; ticket: any }> {
    return request(`/api/tickets/${id}/claim`, { method: 'POST' });
  },

  async releaseTicket(id: string): Promise<{ ticket: any }> {
    return request(`/api/tickets/${id}/release`, { method: 'POST' });
  },

  async sendReply(id: string, message: string): Promise<{ message: any }> {
    return request(`/api/tickets/${id}/reply`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    });
  },

  async addNote(id: string, note: string): Promise<{ note: any }> {
    return request(`/api/tickets/${id}/note`, {
      method: 'POST',
      body: JSON.stringify({ note }),
    });
  },

  async updateStatus(id: string, status: TicketStatus): Promise<{ ticket: any }> {
    return request(`/api/tickets/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  },

  async updatePriority(id: string, priority: TicketPriority): Promise<{ ticket: any }> {
    return request(`/api/tickets/${id}/priority`, {
      method: 'PATCH',
      body: JSON.stringify({ priority }),
    });
  },

  async reopenTicket(id: string): Promise<{ ticket: any }> {
    return request(`/api/tickets/${id}/reopen`, { method: 'POST' });
  },

  async verifyAudit(id: string): Promise<{ valid: boolean; totalEvents: number; brokenEventId?: string; reason?: string }> {
    return request(`/api/tickets/${id}/verify`);
  },

  // Portal
  async createPortalTicket(data: {
    severity: 'critical' | 'medium' | 'low';
    subject: string;
    customer_name: string;
    customer_email: string;
    initial_message: string;
  }): Promise<{ ticket: any }> {
    return request('/api/portal/tickets', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async getPortalTicket(token: string): Promise<any> {
    return request(`/api/portal/tickets/${token}`);
  },

  async portalReply(token: string, message: string): Promise<any> {
    return request(`/api/portal/tickets/${token}/reply`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    });
  },

  async portalReopen(token: string): Promise<any> {
    return request(`/api/portal/tickets/${token}/reopen`, {
      method: 'POST',
    });
  },
};
