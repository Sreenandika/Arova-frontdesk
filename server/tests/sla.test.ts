import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { createCalendar } from '../src/sla/calendar.js';
import {
  isWorkingTime,
  nextWorkingOpen,
  addBusinessMinutes,
  businessMinutesBetween,
  computeDeadline,
  computeTicketDeadlines,
  AUTO_CLOSE_WORKING_MINUTES,
  REOPEN_WINDOW_WORKING_MINUTES,
} from '../src/sla/engine.js';

describe('Phase 2: Pure SLA Engine Tests', () => {
  const calendar = createCalendar(['2026-11-25', '2026-12-25', '2027-01-26']);
  const tz = 'Asia/Kolkata';

  it('correctly detects working hours and non-working hours', () => {
    // Friday 10:00 IST -> Working
    const friWorking = DateTime.fromISO('2026-11-20T10:00:00', { zone: tz }).toJSDate();
    expect(isWorkingTime(friWorking, calendar)).toBe(true);

    // Friday 09:00 IST (before 09:30) -> Non-working
    const friEarly = DateTime.fromISO('2026-11-20T09:00:00', { zone: tz }).toJSDate();
    expect(isWorkingTime(friEarly, calendar)).toBe(false);

    // Friday 18:30 IST (at closing) -> Non-working
    const friClosing = DateTime.fromISO('2026-11-20T18:30:00', { zone: tz }).toJSDate();
    expect(isWorkingTime(friClosing, calendar)).toBe(false);

    // Saturday 14:00 IST -> Weekend non-working
    const satTime = DateTime.fromISO('2026-11-21T14:00:00', { zone: tz }).toJSDate();
    expect(isWorkingTime(satTime, calendar)).toBe(false);

    // Holiday Wednesday 2026-11-25 11:00 IST -> Non-working
    const holidayTime = DateTime.fromISO('2026-11-25T11:00:00', { zone: tz }).toJSDate();
    expect(isWorkingTime(holidayTime, calendar)).toBe(false);
  });

  it('calculates nextWorkingOpen correctly', () => {
    // During working hours -> returns itself
    const fri10 = DateTime.fromISO('2026-11-20T10:00:00', { zone: tz }).toJSDate();
    expect(nextWorkingOpen(fri10, calendar).toISOString()).toBe(fri10.toISOString());

    // Friday before 09:30 -> opens Friday 09:30
    const fri08 = DateTime.fromISO('2026-11-20T08:00:00', { zone: tz }).toJSDate();
    const openFri = DateTime.fromJSDate(nextWorkingOpen(fri08, calendar), { zone: tz });
    expect(openFri.toISODate()).toBe('2026-11-20');
    expect(openFri.hour).toBe(9);
    expect(openFri.minute).toBe(30);

    // Friday after 18:30 -> opens Monday 09:30
    const fri20 = DateTime.fromISO('2026-11-20T20:00:00', { zone: tz }).toJSDate();
    const openMon = DateTime.fromJSDate(nextWorkingOpen(fri20, calendar), { zone: tz });
    expect(openMon.toISODate()).toBe('2026-11-23');
    expect(openMon.hour).toBe(9);
    expect(openMon.minute).toBe(30);
  });

  it('handles Friday 18:00 arrival (not late on Sunday)', () => {
    // Ticket arrives Friday at 18:00 IST
    const fridayArrival = DateTime.fromISO('2026-11-20T18:00:00', { zone: tz }).toJSDate();
    const sundayNoon = DateTime.fromISO('2026-11-22T12:00:00', { zone: tz }).toJSDate();

    // Elapsed business time between arrival and Sunday noon is only 30 minutes (Friday 18:00-18:30)
    const elapsedMinutes = businessMinutesBetween(fridayArrival, sundayNoon, calendar);
    expect(elapsedMinutes).toBe(30);

    // For Low priority (first reply = 9 hours = 540 min), reply deadline is Monday 18:00
    const { replyDeadline, resolveDeadline } = computeTicketDeadlines(
      fridayArrival,
      'low',
      [],
      calendar,
      sundayNoon
    );

    const replyDeadlineDt = DateTime.fromJSDate(replyDeadline, { zone: tz });
    expect(replyDeadlineDt.toISODate()).toBe('2026-11-23'); // Monday
    expect(replyDeadlineDt.hour).toBe(18);
    expect(replyDeadlineDt.minute).toBe(0);

    // On Sunday noon, ticket is NOT late
    expect(sundayNoon.getTime() > replyDeadline.getTime()).toBe(false);
    expect(sundayNoon.getTime() > resolveDeadline.getTime()).toBe(false);
  });

  it('handles Saturday arrival', () => {
    // Ticket arrives Saturday 14:00 IST
    const saturdayArrival = DateTime.fromISO('2026-11-21T14:00:00', { zone: tz }).toJSDate();

    // Next working open is Monday 09:30
    const open = DateTime.fromJSDate(nextWorkingOpen(saturdayArrival, calendar), { zone: tz });
    expect(open.toISODate()).toBe('2026-11-23');
    expect(open.hour).toBe(9);
    expect(open.minute).toBe(30);

    // Medium priority targets:
    // First reply: 4.5 working hours -> Monday 14:00
    // Resolution: 3 working days (27 working hours) -> Wednesday 18:30
    const { replyDeadline, resolveDeadline } = computeTicketDeadlines(
      saturdayArrival,
      'medium',
      [],
      calendar
    );

    const replyDt = DateTime.fromJSDate(replyDeadline, { zone: tz });
    expect(replyDt.toISODate()).toBe('2026-11-23');
    expect(replyDt.hour).toBe(14);
    expect(replyDt.minute).toBe(0);

    const resolveDt = DateTime.fromJSDate(resolveDeadline, { zone: tz });
    // Since 2026-11-25 is a holiday in this calendar, 3 working days (27 working hours) from Mon 09:30 are:
    // Day 1: Mon 2026-11-23 (9h)
    // Day 2: Tue 2026-11-24 (9h)
    // Wed 2026-11-25 is skipped (holiday)
    // Day 3: Thu 2026-11-26 (9h) -> ends at 18:30 on 2026-11-26
    expect(resolveDt.toISODate()).toBe('2026-11-26');
    expect(resolveDt.hour).toBe(18);
    expect(resolveDt.minute).toBe(30);
  });

  it('handles holiday in the middle properly', () => {
    // Calendar has holiday on Wednesday 2026-11-25
    // Ticket arrives Tuesday 2026-11-24 17:00 IST with 120m (2 hours) first reply target
    const start = DateTime.fromISO('2026-11-24T17:00:00', { zone: tz }).toJSDate();
    const replyDeadline = addBusinessMinutes(start, 120, calendar);

    // Tuesday 17:00 to 18:30 = 90 mins. Remaining 30 mins.
    // Wednesday 2026-11-25 is holiday.
    // Thursday 2026-11-26 09:30 + 30 mins = Thursday 10:00
    const replyDt = DateTime.fromJSDate(replyDeadline, { zone: tz });
    expect(replyDt.toISODate()).toBe('2026-11-26');
    expect(replyDt.hour).toBe(10);
    expect(replyDt.minute).toBe(0);
  });

  it('handles pause across a weekend', () => {
    const pauseStart = DateTime.fromISO('2026-11-20T17:30:00', { zone: tz }).toJSDate(); // Friday 17:30
    const pauseEnd = DateTime.fromISO('2026-11-23T10:30:00', { zone: tz }).toJSDate(); // Monday 10:30

    // Paused business minutes: Friday 60m (17:30-18:30) + Weekend 0m + Monday 60m (09:30-10:30) = 120m
    const pausedTime = businessMinutesBetween(pauseStart, pauseEnd, calendar);
    expect(pausedTime).toBe(120);

    // Created Friday 10:00 IST. Unpaused reply deadline for medium (4.5h = 270m) is Friday 14:30.
    const created = DateTime.fromISO('2026-11-20T10:00:00', { zone: tz }).toJSDate();
    const deadlineWithPause = computeDeadline(
      created,
      270,
      [{ started_at: pauseStart, ended_at: pauseEnd }],
      calendar,
      false
    );

    const deadlineDt = DateTime.fromJSDate(deadlineWithPause, { zone: tz });
    // Extended by 120m: Friday 14:30 + 120m = Friday 16:30
    expect(deadlineDt.toISODate()).toBe('2026-11-20');
    expect(deadlineDt.hour).toBe(16);
    expect(deadlineDt.minute).toBe(30);
  });

  it('handles critical ticket created at 17:00 (end of same working day rule)', () => {
    // Critical ticket created Friday 17:00
    const start = DateTime.fromISO('2026-11-20T17:00:00', { zone: tz }).toJSDate();
    const { replyDeadline, resolveDeadline } = computeTicketDeadlines(start, 'critical', [], calendar);

    // First reply deadline: 2 hours (120 min) -> 90m Friday + 30m Monday = Monday 10:00
    const replyDt = DateTime.fromJSDate(replyDeadline, { zone: tz });
    expect(replyDt.toISODate()).toBe('2026-11-23');
    expect(replyDt.hour).toBe(10);
    expect(replyDt.minute).toBe(0);

    // Resolve deadline: "by the END of the same working day (18:30)" -> Friday 18:30
    const resolveDt = DateTime.fromJSDate(resolveDeadline, { zone: tz });
    expect(resolveDt.toISODate()).toBe('2026-11-20');
    expect(resolveDt.hour).toBe(18);
    expect(resolveDt.minute).toBe(30);
  });

  it('handles medium ticket across two weeks without holidays', () => {
    const calNoHolidays = createCalendar([]);
    // Created Thursday 2026-11-19 14:00 IST
    // Target: 27 working hours (3 working days)
    // Thu: 4.5h -> Fri: 9h (13.5h) -> Mon: 9h (22.5h) -> Tue: 4.5h (27h) at 14:00
    const start = DateTime.fromISO('2026-11-19T14:00:00', { zone: tz }).toJSDate();
    const { resolveDeadline } = computeTicketDeadlines(start, 'medium', [], calNoHolidays);

    const resolveDt = DateTime.fromJSDate(resolveDeadline, { zone: tz });
    expect(resolveDt.toISODate()).toBe('2026-11-24'); // Tuesday
    expect(resolveDt.hour).toBe(14);
    expect(resolveDt.minute).toBe(0);
  });

  it('recalculates deadlines on priority change mid-ticket', () => {
    const calNoHolidays = createCalendar([]);
    // Ticket created Monday 09:30 as Low (resolve = 5 days -> Friday 18:30)
    const created = DateTime.fromISO('2026-11-16T09:30:00', { zone: tz }).toJSDate();

    // At Tuesday 12:00, priority changed to Critical
    const tuesdayNoon = DateTime.fromISO('2026-11-17T12:00:00', { zone: tz }).toJSDate();

    // Recalculating from clock_started_at (Monday 09:30):
    // For critical, resolve deadline was Monday 18:30
    const { resolveDeadline: critResolve } = computeTicketDeadlines(
      created,
      'critical',
      [],
      calNoHolidays,
      tuesdayNoon
    );

    const critDt = DateTime.fromJSDate(critResolve, { zone: tz });
    expect(critDt.toISODate()).toBe('2026-11-16');
    expect(critDt.hour).toBe(18);
    expect(critDt.minute).toBe(30);

    // Since now is Tuesday 12:00 and deadline was Monday 18:30, it is immediately late!
    expect(tuesdayNoon.getTime() > critResolve.getTime()).toBe(true);
  });

  it('validates 5-working-day auto-close boundary', () => {
    const calNoHolidays = createCalendar([]);
    // Paused Monday 09:30
    const pauseStart = DateTime.fromISO('2026-11-16T09:30:00', { zone: tz }).toJSDate();

    // 5 working days = 5 * 540 = 2700 minutes -> Friday 18:30
    const friday1829 = DateTime.fromISO('2026-11-20T18:29:00', { zone: tz }).toJSDate();
    const friday1830 = DateTime.fromISO('2026-11-20T18:30:00', { zone: tz }).toJSDate();

    const elapsedAt1829 = businessMinutesBetween(pauseStart, friday1829, calNoHolidays);
    expect(elapsedAt1829).toBe(2699);
    expect(elapsedAt1829 >= AUTO_CLOSE_WORKING_MINUTES).toBe(false);

    const elapsedAt1830 = businessMinutesBetween(pauseStart, friday1830, calNoHolidays);
    expect(elapsedAt1830).toBe(2700);
    expect(elapsedAt1830 >= AUTO_CLOSE_WORKING_MINUTES).toBe(true);
  });

  it('validates 5-working-day reopen boundary', () => {
    const calNoHolidays = createCalendar([]);
    // Resolved Monday 18:30
    const resolvedAt = DateTime.fromISO('2026-11-16T18:30:00', { zone: tz }).toJSDate();

    // 5 working days later: Mon (23rd) 18:30
    const mon1700 = DateTime.fromISO('2026-11-23T17:00:00', { zone: tz }).toJSDate();
    const tue1000 = DateTime.fromISO('2026-11-24T10:00:00', { zone: tz }).toJSDate();

    const elapsedMon = businessMinutesBetween(resolvedAt, mon1700, calNoHolidays);
    expect(elapsedMon <= REOPEN_WINDOW_WORKING_MINUTES).toBe(true); // Can reopen

    const elapsedTue = businessMinutesBetween(resolvedAt, tue1000, calNoHolidays);
    expect(elapsedTue > REOPEN_WINDOW_WORKING_MINUTES).toBe(true); // Refused, must create new ticket
  });
});
