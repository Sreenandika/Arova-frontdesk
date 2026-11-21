import { config } from '../config.js';

export interface Calendar {
  timezone: string;
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
  holidays: Set<string>; // Set of 'YYYY-MM-DD'
}

export function createCalendar(holidays: string[] = []): Calendar {
  return {
    timezone: config.business.tz,
    startHour: config.business.startHour,
    startMinute: config.business.startMinute,
    endHour: config.business.endHour,
    endMinute: config.business.endMinute,
    holidays: new Set(holidays),
  };
}

export const defaultSampleCalendar = createCalendar([
  '2026-12-25',
  '2027-01-26',
]);
