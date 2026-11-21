export interface User {
  id: string;
  name: string;
  email: string;
  role: 'agent' | 'manager';
}

export type TicketPriority = 'low' | 'medium' | 'critical';
export type TicketStatus = 'open' | 'waiting_on_customer' | 'resolved' | 'closed';

export interface SlaDeadlines {
  replyDeadline: string;
  resolveDeadline: string;
}

export interface TicketSummary {
  id: string;
  number: string;
  subject: string;
  customer_name: string;
  customer_email: string;
  priority: TicketPriority;
  status: TicketStatus;
  assignee_id: string | null;
  assignee_name: string | null;
  assignee_email: string | null;
  version: number;
  public_token: string;
  clock_started_at: string;
  first_response_at: string | null;
  resolved_at: string | null;
  parent_ticket_id: string | null;
  created_at: string;
  deadlines: SlaDeadlines;
  isReplyMet: boolean;
  isResolveMet: boolean;
  isReplyLate: boolean;
  isResolveLate: boolean;
  isLate: boolean;
  remainingReplyMinutes: number;
  remainingResolveMinutes: number;
}

export interface TicketMessage {
  id: string;
  ticket_id: string;
  sender_type: 'agent' | 'customer';
  sender_id: string | null;
  sender_name: string;
  message: string;
  created_at: string;
}

export interface InternalNote {
  id: string;
  ticket_id: string;
  author_id: string;
  author_name: string;
  note: string;
  created_at: string;
}

export interface TicketEvent {
  id: string;
  ticket_id: string;
  type: string;
  actor_type: 'agent' | 'customer' | 'system';
  actor_id: string | null;
  payload: any;
  created_at: string;
  prev_hash: string;
  hash: string;
}

export interface TicketDetailData {
  ticket: TicketSummary;
  messages: TicketMessage[];
  notes: InternalNote[];
  events: TicketEvent[];
  deadlines: SlaDeadlines;
  isReplyLate: boolean;
  isResolveLate: boolean;
  isLate: boolean;
  canReopen: boolean;
}
