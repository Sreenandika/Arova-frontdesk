# Frontdesk — Support Ticket System (Arvo Systems)

Frontdesk is a resilient, audit-provable support ticket system built for **Arvo Systems** (supporting 9 support agents, ~40 tickets/day). It features exact business-time SLA tracking in the `Asia/Kolkata` timezone (09:30–18:30 Mon–Fri), cryptographic hash chaining, strict privacy boundaries, and database-level immutability guarantees.

---

## Live URL

- **Production Deployment**: `https://arvo-frontdesk.onrender.com` *(Placeholder / Render deployment ready)*

---

## Architecture Overview

```
                      ┌──────────────────────────────────────────────┐
                      │              Express.js App                  │
                      │  (Single service hosting Web dist & API)     │
                      └───────┬──────────────────────────────┬───────┘
                              │                              │
              ┌───────────────▼──────────────┐ ┌─────────────▼────────────────┐
              │      Agent API Layer         │ │     Isolated Portal Layer    │
              │   /api/auth, /api/tickets    │ │         /api/portal/*        │
              │  (Full access: notes + msgs) │ │ (Zero access to internal_notes)│
              └───────────────┬──────────────┘ └─────────────┬────────────────┘
                              │                              │
                              └───────────────┬──────────────┘
                                              │
                      ┌───────────────────────▼──────────────────────┐
                      │            PostgreSQL 18 Database            │
                      │  - tickets (optimistic locking version)      │
                      │  - ticket_messages (customer-visible)        │
                      │  - internal_notes (separate table, team-only)│
                      │  - ticket_events (append-only, hash chained) │
                      │  - sla_pauses (business clock intervals)     │
                      │  - holidays (dynamic calendar exclusions)    │
                      │  - DB triggers (block UPDATE/DELETE/TRUNCATE)│
                      └──────────────────────────────────────────────┘
```

- **Backend**: Node.js 20 + TypeScript + Express + PostgreSQL via `pg` (pure SQL migrations, zero heavy ORMs), Zod input validation, JWT authentication with httpOnly cookie / Bearer support, bcrypt password hashing.
- **Frontend**: React 18 + Vite + TypeScript + clean plain CSS (no bulky UI libraries). Compiled and statically served by Express on one single port.
- **Tests**: Vitest with real PostgreSQL databases for pure SLA unit tests, concurrency tests, canary tests, and immutability triggers.

---

## Seeded Staff Logins

Password for all accounts: **`password123`**

| Role | Name | Email | Permissions |
|---|---|---|---|
| **Manager** | Vikram Rao | `manager@arvo.test` | View all, reassign, release, manage holidays, full SLA metrics |
| **Agent 1** | Aarav Sharma | `agent1@arvo.test` | Claim, reply, add team notes, status updates |
| **Agent 2** | Diya Patel | `agent2@arvo.test` | Claim, reply, add team notes, status updates |
| **Agent 3** | Rohan Mehta | `agent3@arvo.test` | Claim, reply, add team notes, status updates |
| **Agent 4** | Ananya Iyer | `agent4@arvo.test` | Claim, reply, add team notes, status updates |
| **Agent 5** | Kabir Singh | `agent5@arvo.test` | Claim, reply, add team notes, status updates |
| **Agent 6** | Pooja Nair | `agent6@arvo.test` | Claim, reply, add team notes, status updates |
| **Agent 7** | Arjun Kapoor | `agent7@arvo.test` | Claim, reply, add team notes, status updates |
| **Agent 8** | Neha Verma | `agent8@arvo.test` | Claim, reply, add team notes, status updates |
| **Agent 9** | Aditya Joshi | `agent9@arvo.test` | Claim, reply, add team notes, status updates |

*(Quick 1-click login buttons are also provided on the sign-in screen).*

---

## How to Run Locally Step-by-Step

### 1. Prerequisites
- Node.js 20+ (Node 20, 22, or 24)
- PostgreSQL 14+ running locally (or via Docker / cloud)

### 2. Database Creation
In `psql` or pgAdmin, create the primary and test databases:
```sql
CREATE DATABASE frontdesk;
CREATE DATABASE frontdesk_test;
```

### 3. Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Ensure `DATABASE_URL` and `TEST_DATABASE_URL` match your PostgreSQL credentials (e.g., `postgresql://postgres:password@127.0.0.1:5432/frontdesk`).

### 4. Install Dependencies
From the repository root:
```bash
npm install
```

### 5. Run Database Migrations
```bash
npm run migrate
```
*(Executes plain SQL migrations in `server/src/db/migrations` establishing schema and immutability triggers).*

### 6. Seed Demo Data
```bash
npm run seed
```
*(Generates the 10 staff members and the 7 realistic scenario tickets through the service layer, ensuring hash chains are cryptographically valid).*

### 7. Run Automated Tests
```bash
npm test
```
Runs the full Vitest suite (pure SLA engine, concurrency claiming, canary isolation, immutability triggers, audit hash verification, portal transitions, and background jobs).

### 8. Run Development Server
```bash
# Run server and web concurrently
npm run server:dev
# in another terminal
npm run web:dev
```
Or build and start the unified production service:
```bash
npm run build
npm start
```
Open **`http://localhost:3000`** in your browser.

---

## The Three Incidents: Structural Impossibility

### A) INC-0291: Double "Take This Ticket"
- **Implementation**: Atomic conditional SQL query inside `server/src/services/ticket.service.ts`:
  ```sql
  UPDATE tickets 
  SET assignee_id = $1, assigned_at = $2, version = version + 1 
  WHERE id = $3 AND assignee_id IS NULL 
  RETURNING *;
  ```
- If 0 rows affected, returns **HTTP 409 Conflict** with who holds the ticket and since when (`{ error: 'Already taken by X', heldBy, heldSince }`).
- Assignee guard: only the current assignee may send public replies or alter status; unassigned tickets cannot be replied to.
- Optimistic concurrency: every ticket update validates and increments a `version` integer column.
- **Verification**: Verified by `server/tests/claim_concurrency.test.ts` firing two concurrent claims via `Promise.all` and asserting exactly one succeeds and one receives 409.

### B) INC-0304: Private Notes Leaking to Customers
- **Implementation**: Internal notes are stored in a physically separate table (`internal_notes`), completely distinct from `ticket_messages`. No dangerous `is_private` boolean column exists.
- The Customer Portal (`/api/portal/*`, `server/src/services/portal.service.ts`) is an isolated module that never references or imports `internal_notes`.
- Event payloads logged for internal notes contain only `{ note_id: ... }`—note bodies are never serialized into events.
- Customer transcript exports (`GET /api/portal/tickets/:token/export`) and Agent CSV exports (`GET /api/tickets/export.csv`) never output note bodies.
- **Verification**: Verified by `server/tests/privacy_canary.test.ts` injecting a unique secret `CANARY-PRIVATE-9137` into an internal note, calling every customer endpoint/export, and asserting the canary string never appears in any response.

### C) INC-0318: No Provable Record
- **Implementation**: Append-only `ticket_events` table with cryptographic SHA-256 hash chaining:
  $$\text{hash} = \text{sha256}(\text{prev\_hash} \parallel \text{ticket\_id} \parallel \text{type} \parallel \text{actor} \parallel \text{canonical\_json\_payload} \parallel \text{created\_at\_iso})$$
- Serialized writers per ticket use `SELECT ... FOR UPDATE` row locks inside single transactions.
- PostgreSQL row- and statement-level triggers raise fatal exceptions on any attempt to `UPDATE`, `DELETE`, or `TRUNCATE` `ticket_events`, `ticket_messages`, or `internal_notes`.
- Server clock is strictly injectable (`Clock` interface) and client timestamps are never accepted.
- Integrity verification endpoint `GET /api/tickets/:id/verify` recalculates every hash from `GENESIS` and flags any tampered row.
- **Verification**: Verified by `server/tests/immutability_audit.test.ts`, asserting triggers abort modifications and verifying tampered rows are pinpointed.

---

## Rules I Found in the Story & Mapping

| Business Rule | Description | Implementation File |
|---|---|---|
| **Rule 1: SLA Targets** | Critical (2h reply, end of day resolve), Medium (4.5h reply, 3d resolve), Low (9h reply, 5d resolve) | `server/src/sla/engine.ts` (`SLA_TARGETS`) |
| **Rule 2: Working Calendar** | 09:30–18:30 Asia/Kolkata, Mon–Fri, excluding weekends & holidays in `holidays` table | `server/src/sla/calendar.ts`, `server/src/sla/engine.ts` (`isWorkingTime`, `nextWorkingOpen`) |
| **Rule 3: SLA Pauses** | Status `waiting_on_customer` pauses clock; customer reply resumes clock; stored in `sla_pauses` | `server/src/services/ticket.service.ts`, `server/src/services/portal.service.ts` |
| **Rule 4: Auto-Close** | If `waiting_on_customer` persists for 5 working days, system closes ticket | `server/src/services/background.service.ts` (`processAutoClose`) |
| **Rule 5: Reopen Window** | Reopening allowed only within 5 working days of resolution; after that, creates new linked ticket | `server/src/services/ticket.service.ts`, `server/src/services/portal.service.ts` |
| **Rule 6: Priority Recalculation** | Mid-ticket priority change recalculates deadlines from start; logs `PRIORITY_CHANGED` | `server/src/services/ticket.service.ts` (`updateTicketPriority`) |
| **Rule 7: Late & Background Ticks** | Lateness computed dynamically on read; background tick logs idempotent `SLA_BREACHED` | `server/src/services/background.service.ts` (`processSlaBreaches`) |
| **Manager Holidays** | Manager endpoint to add/remove holiday dates | `server/src/routes/holiday.routes.ts`, `server/src/services/holiday.service.ts` |

---

## Assumptions and Decisions

1. **Mid-Ticket Priority Changes (Rule 6)**:
   - When an agent adjusts priority mid-ticket, both deadlines are recalculated from the original `clock_started_at` using the new priority's target minutes, while adding accumulated paused business time.
   - If the recalculated deadline is in the past relative to the server's current time, the ticket is immediately treated as late.
   - Historical events are never mutated. A new `PRIORITY_CHANGED` event is appended containing `{ old_priority, new_priority, old_reply_deadline, new_reply_deadline, old_resolve_deadline, new_resolve_deadline }`.
2. **Exact Working-Day Targets ("about three days / about one week")**:
   - "Half a day" = 4.5 working hours = **270 working minutes**.
   - "One day" = 9.0 working hours = **540 working minutes**.
   - "About three days" (medium resolution) = 3 working days = 27 working hours = **1620 working minutes**.
   - "About one week" (low resolution & auto-close window) = 5 working days = 45 working hours = **2700 working minutes**.
3. **Reopen Lifecycle & SLA Clock**:
   - When a ticket is reopened within the 5-working-day window (2700 business minutes from `resolved_at`), the ticket status resets to `open`, the first-response requirement is marked as already met, and `clock_started_at` is set to the reopen timestamp to restart the resolution SLA clock.
   - If reopen is attempted after 5 working days, reopening is rejected and a new ticket is generated linked via `parent_ticket_id`.
4. **Initial Priority Determination**:
   - Initial ticket priority is established by the customer's severity response during ticket submission:
     - *"I cannot work at all"* $\rightarrow$ `critical`
     - *"Something is wrong but I can work"* $\rightarrow$ `medium`
     - *"Question or small request"* $\rightarrow$ `low`
   - An assigned agent or manager can elevate or downgrade priority as needed.
5. **Timezone & Non-Working Arrivals**:
   - Tickets created outside working hours (nights, weekends, holidays) have their effective business SLA clock start at `09:30:00` on the next working day.
   - A critical ticket submitted during working hours must be resolved by `18:30:00` of that same working day. If submitted outside working hours (e.g. Sunday), its resolution deadline is `18:30:00` of the next working day (Monday).
