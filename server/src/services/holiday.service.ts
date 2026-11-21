import { pool } from '../db/pool.js';
import { createCalendar, Calendar } from '../sla/calendar.js';

export interface HolidayRecord {
  id: string;
  holiday_date: string; // YYYY-MM-DD
  description: string;
  is_sample: boolean;
  created_at: string;
}

export async function getAllHolidays(): Promise<HolidayRecord[]> {
  const { rows } = await pool.query(
    'SELECT id, to_char(holiday_date, \'YYYY-MM-DD\') as holiday_date, description, is_sample, created_at FROM holidays ORDER BY holiday_date ASC'
  );
  return rows;
}

export async function addHoliday(holidayDate: string, description: string, isSample: boolean = false): Promise<HolidayRecord> {
  const { rows } = await pool.query(
    `INSERT INTO holidays (holiday_date, description, is_sample)
     VALUES ($1, $2, $3)
     ON CONFLICT (holiday_date) DO UPDATE 
     SET description = EXCLUDED.description
     RETURNING id, to_char(holiday_date, 'YYYY-MM-DD') as holiday_date, description, is_sample, created_at`,
    [holidayDate, description, isSample]
  );
  return rows[0];
}

export async function removeHoliday(idOrDate: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM holidays WHERE id::text = $1 OR to_char(holiday_date, 'YYYY-MM-DD') = $1`,
    [idOrDate]
  );
  return (rowCount ?? 0) > 0;
}

export async function getLiveCalendar(): Promise<Calendar> {
  const holidays = await getAllHolidays();
  const dateStrings = holidays.map(h => h.holiday_date);
  return createCalendar(dateStrings);
}
