import { DateTime } from 'luxon';
import { Calendar } from './calendar.js';

export type TicketPriority = 'low' | 'medium' | 'critical';

export interface SlaTargets {
  firstReplyMinutes: number;
  resolveMinutes: number;
  isCriticalResolve: boolean;
}

export const SLA_TARGETS: Record<TicketPriority, SlaTargets> = {
  critical: {
    firstReplyMinutes: 2 * 60, // 120m (2 working hours)
    resolveMinutes: 0, // Handled specially: "end of the same working day (18:30)"
    isCriticalResolve: true,
  },
  medium: {
    firstReplyMinutes: 4.5 * 60, // 270m (4.5 working hours / half day)
    resolveMinutes: 27 * 60, // 1620m (27 working hours / 3 working days)
    isCriticalResolve: false,
  },
  low: {
    firstReplyMinutes: 9 * 60, // 540m (9 working hours / 1 working day)
    resolveMinutes: 45 * 60, // 2700m (45 working hours / 5 working days)
    isCriticalResolve: false,
  },
};

export const AUTO_CLOSE_WORKING_MINUTES = 45 * 60; // 5 working days = 2700 minutes
export const REOPEN_WINDOW_WORKING_MINUTES = 45 * 60; // 5 working days = 2700 minutes

export interface PauseInterval {
  started_at: Date | string;
  ended_at?: Date | string | null;
}

function toDateTime(date: Date | string | DateTime, calendar: Calendar): DateTime {
  if (DateTime.isDateTime(date)) {
    return date.setZone(calendar.timezone);
  }
  if (typeof date === 'string') {
    return DateTime.fromISO(date, { zone: calendar.timezone });
  }
  return DateTime.fromJSDate(date, { zone: calendar.timezone });
}

export function isWorkingDay(dt: DateTime, calendar: Calendar): boolean {
  // Monday = 1, Sunday = 7 in Luxon
  if (dt.weekday === 6 || dt.weekday === 7) {
    return false;
  }
  const dateStr = dt.toISODate();
  if (dateStr && calendar.holidays.has(dateStr)) {
    return false;
  }
  return true;
}

export function isWorkingTime(input: Date | string | DateTime, calendar: Calendar): boolean {
  const dt = toDateTime(input, calendar);
  if (!isWorkingDay(dt, calendar)) {
    return false;
  }

  const currentMinute = dt.hour * 60 + dt.minute;
  const startMinute = calendar.startHour * 60 + calendar.startMinute;
  const endMinute = calendar.endHour * 60 + calendar.endMinute;

  return currentMinute >= startMinute && currentMinute < endMinute;
}

export function nextWorkingOpen(input: Date | string | DateTime, calendar: Calendar): Date {
  let dt = toDateTime(input, calendar);

  // If currently within working hours, the next working moment is now
  if (isWorkingTime(dt, calendar)) {
    return dt.toJSDate();
  }

  // If on a working day before start time, open is today at startHour:startMinute
  const currentMinute = dt.hour * 60 + dt.minute;
  const startMinute = calendar.startHour * 60 + calendar.startMinute;

  if (isWorkingDay(dt, calendar) && currentMinute < startMinute) {
    return dt.set({
      hour: calendar.startHour,
      minute: calendar.startMinute,
      second: 0,
      millisecond: 0,
    }).toJSDate();
  }

  // Otherwise (after working hours, or weekend, or holiday), advance to next calendar day at 00:00 and seek
  dt = dt.plus({ days: 1 }).set({
    hour: calendar.startHour,
    minute: calendar.startMinute,
    second: 0,
    millisecond: 0,
  });

  while (!isWorkingDay(dt, calendar)) {
    dt = dt.plus({ days: 1 });
  }

  return dt.toJSDate();
}

export function addBusinessMinutes(
  input: Date | string | DateTime,
  minutesToAdd: number,
  calendar: Calendar
): Date {
  if (minutesToAdd < 0) {
    throw new Error('minutesToAdd must be non-negative');
  }
  if (minutesToAdd === 0) {
    return toDateTime(input, calendar).toJSDate();
  }

  let dt = toDateTime(input, calendar);

  // If outside working hours, start at the next working opening
  if (!isWorkingTime(dt, calendar)) {
    dt = toDateTime(nextWorkingOpen(dt, calendar), calendar);
  }

  let remaining = minutesToAdd;

  while (remaining > 0) {
    const endOfDay = dt.set({
      hour: calendar.endHour,
      minute: calendar.endMinute,
      second: 0,
      millisecond: 0,
    });

    const minutesLeftToday = Math.max(0, Math.floor(endOfDay.diff(dt, 'minutes').minutes));

    if (remaining <= minutesLeftToday) {
      dt = dt.plus({ minutes: remaining });
      remaining = 0;
    } else {
      remaining -= minutesLeftToday;
      // Advance to next working open day
      dt = toDateTime(nextWorkingOpen(endOfDay.plus({ minutes: 1 }), calendar), calendar);
    }
  }

  return dt.toJSDate();
}

export function businessMinutesBetween(
  aInput: Date | string | DateTime,
  bInput: Date | string | DateTime,
  calendar: Calendar
): number {
  let a = toDateTime(aInput, calendar);
  let b = toDateTime(bInput, calendar);

  if (a > b) {
    return -businessMinutesBetween(b, a, calendar);
  }

  // Same calendar day fast-path
  if (a.hasSame(b, 'day')) {
    if (!isWorkingDay(a, calendar)) {
      return 0;
    }

    const dayStart = a.set({
      hour: calendar.startHour,
      minute: calendar.startMinute,
      second: 0,
      millisecond: 0,
    });
    const dayEnd = a.set({
      hour: calendar.endHour,
      minute: calendar.endMinute,
      second: 0,
      millisecond: 0,
    });

    const clampedA = a < dayStart ? dayStart : a > dayEnd ? dayEnd : a;
    const clampedB = b < dayStart ? dayStart : b > dayEnd ? dayEnd : b;

    return Math.max(0, Math.floor(clampedB.diff(clampedA, 'minutes').minutes));
  }

  let totalMinutes = 0;

  // Day 1: clamped from a to day1End
  if (isWorkingDay(a, calendar)) {
    const day1Start = a.set({
      hour: calendar.startHour,
      minute: calendar.startMinute,
      second: 0,
      millisecond: 0,
    });
    const day1End = a.set({
      hour: calendar.endHour,
      minute: calendar.endMinute,
      second: 0,
      millisecond: 0,
    });

    const clampedA = a < day1Start ? day1Start : a > day1End ? day1End : a;
    totalMinutes += Math.max(0, Math.floor(day1End.diff(clampedA, 'minutes').minutes));
  }

  // Intermediate full days
  let cursor = a.plus({ days: 1 }).startOf('day');
  const bDayStart = b.startOf('day');

  const dailyMinutes =
    (calendar.endHour * 60 + calendar.endMinute) - (calendar.startHour * 60 + calendar.startMinute);

  while (cursor < bDayStart) {
    if (isWorkingDay(cursor, calendar)) {
      totalMinutes += dailyMinutes;
    }
    cursor = cursor.plus({ days: 1 });
  }

  // Final Day (b)
  if (isWorkingDay(b, calendar)) {
    const dayBStart = b.set({
      hour: calendar.startHour,
      minute: calendar.startMinute,
      second: 0,
      millisecond: 0,
    });
    const dayBEnd = b.set({
      hour: calendar.endHour,
      minute: calendar.endMinute,
      second: 0,
      millisecond: 0,
    });

    const clampedB = b < dayBStart ? dayBStart : b > dayBEnd ? dayBEnd : b;
    totalMinutes += Math.max(0, Math.floor(clampedB.diff(dayBStart, 'minutes').minutes));
  }

  return totalMinutes;
}

export function calculateTotalPausedMinutes(
  pauses: PauseInterval[],
  calendar: Calendar,
  now: Date | string = new Date()
): number {
  let total = 0;
  for (const pause of pauses) {
    const end = pause.ended_at ? pause.ended_at : now;
    total += businessMinutesBetween(pause.started_at, end, calendar);
  }
  return total;
}

export function computeDeadline(
  startInput: Date | string | DateTime,
  targetMinutes: number,
  pauses: PauseInterval[],
  calendar: Calendar,
  isCriticalResolve: boolean = false,
  nowInput: Date | string = new Date()
): Date {
  const now = toDateTime(nowInput, calendar).toJSDate();
  const pausedMinutes = calculateTotalPausedMinutes(pauses, calendar, now);

  if (isCriticalResolve) {
    // Critical resolve deadline: end of the same working day (18:30) of the effective start day
    let dt = toDateTime(startInput, calendar);
    if (!isWorkingTime(dt, calendar)) {
      dt = toDateTime(nextWorkingOpen(dt, calendar), calendar);
    }

    const endOfEffectiveDay = dt.set({
      hour: calendar.endHour,
      minute: calendar.endMinute,
      second: 0,
      millisecond: 0,
    }).toJSDate();

    if (pausedMinutes > 0) {
      return addBusinessMinutes(endOfEffectiveDay, pausedMinutes, calendar);
    }
    return endOfEffectiveDay;
  }

  let effectiveStart = toDateTime(startInput, calendar);
  if (!isWorkingTime(effectiveStart, calendar)) {
    effectiveStart = toDateTime(nextWorkingOpen(effectiveStart, calendar), calendar);
  }

  return addBusinessMinutes(effectiveStart.toJSDate(), targetMinutes + pausedMinutes, calendar);
}

export function computeTicketDeadlines(
  clockStartedAt: Date | string,
  priority: TicketPriority,
  pauses: PauseInterval[],
  calendar: Calendar,
  now: Date | string = new Date()
): { replyDeadline: Date; resolveDeadline: Date } {
  const targets = SLA_TARGETS[priority];

  const replyDeadline = computeDeadline(
    clockStartedAt,
    targets.firstReplyMinutes,
    pauses,
    calendar,
    false,
    now
  );

  const resolveDeadline = computeDeadline(
    clockStartedAt,
    targets.resolveMinutes,
    pauses,
    calendar,
    targets.isCriticalResolve,
    now
  );

  return { replyDeadline, resolveDeadline };
}
