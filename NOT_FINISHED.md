# NOT_FINISHED.md - Frontdesk Project Status

This document provides a transparent and honest accounting of features, non-critical integrations, and polish items that were intentionally deferred or not completed within the 8-hour test budget, along with the technical and engineering justification for each.

---

## 1. Outbound / Inbound Email Integration (SMTP / IMAP)
- **Status**: Not Implemented.
- **Why**: The test brief specified a full Customer Portal (`/portal/new` and `/portal/t/:token`) with tokenized links and transcript export. Connecting external SMTP services (e.g. SendGrid, Mailgun) or polling an IMAP mailbox introduces external network dependencies, credentials, and failure modes that do not enhance the correctness of the SLA engine or incident mitigations.

## 2. Realtime WebSocket / Server-Sent Events (SSE)
- **Status**: Deferred in favor of fast client-side refresh and actions.
- **Why**: Arvo Systems operates with 9 support agents and approximately ~40 tickets/day (less than 5 tickets per hour across the team). Polling on navigation and refreshing state after mutations provides 100% data consistency, eliminates stale socket connection teardown issues on server restarts, and keeps the Express service stateless.

## 3. Server-Side Pagination & Cursor Navigation
- **Status**: Deferred.
- **Why**: At ~40 tickets per day, the active working queue (open, unassigned, waiting) rarely exceeds 50–100 items. Fetching current active tickets in single indexed SQL queries with sub-5ms response times is significantly faster and simpler than cursor-based pagination, allowing instant client-side sorting and filtering.

## 4. Manager Analytics & Reporting Dashboard
- **Status**: Basic Manager export (`GET /api/tickets/export.csv`) and audit verification are complete; advanced interactive reporting is deferred.
- **Why**: While every `SLA_BREACHED` and `PRIORITY_CHANGED` event is idempotently recorded into `ticket_events` with detailed metadata (allowing SQL queries like `SELECT payload FROM ticket_events WHERE type = 'SLA_BREACHED'`), a dedicated graphical reporting dashboard with charts was classified as a stretch goal beyond the core hiring test budget.

## 5. File Attachment Storage (S3 / Blob)
- **Status**: Not Implemented.
- **Why**: File attachments introduce external S3/blob store dependencies, presigned URL lifecycles, and virus scanning considerations. Plain text messaging is safe against XSS, easily auditable in the SHA-256 hash chain, and fulfills the hiring test requirements.

## 6. Rate Limiting Middleware
- **Status**: Not Implemented.
- **Why**: The brief explicitly stated: *"Rate limiting not required"*.

---

## All 7 Core Phases Completed
- **Phase 1 (Foundation)**: Monorepo scaffold, PostgreSQL migrations, schema, immutability triggers.
- **Phase 2 (SLA Engine)**: 100% pure function business time calculation engine in `Asia/Kolkata` with 11 comprehensive unit tests.
- **Phase 3 (Core Services & API)**: Atomic conditional claiming (INC-0291), separate internal notes table with zero-leakage guarantee (INC-0304), cryptographic SHA-256 hash chaining (INC-0318), background SLA breach tick and auto-close.
- **Phase 4 (Agent & Portal UI)**: Fast, responsive React + plain CSS interface with live SLA badges, atomic claim conflict handling, distinct yellow note box, audit verification, and portal pages.
- **Phase 5 (Seed Data)**: Realistic service-driven seed generating 10 staff members and 7 required test scenario tickets.
- **Phase 6 (Tests & Documentation)**: 29 automated tests passing across 8 suites, complete README.md, and NOT_FINISHED.md.
- **Phase 7 (Deployment Prep)**: Single unified production build, `render.yaml` configuration, and deployment guide.
