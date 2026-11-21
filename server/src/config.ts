import dotenv from 'dotenv';
import path from 'path';

// Load .env from workspace root or server directory
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  jwtSecret: process.env.JWT_SECRET || 'arvo-frontdesk-super-secret-jwt-key-2026',
  databaseUrl:
    process.env.NODE_ENV === 'test'
      ? process.env.TEST_DATABASE_URL || 'postgresql://postgres@127.0.0.1:5433/frontdesk_test'
      : process.env.DATABASE_URL || 'postgresql://postgres@127.0.0.1:5433/frontdesk',
  testDatabaseUrl: process.env.TEST_DATABASE_URL || 'postgresql://postgres@127.0.0.1:5433/frontdesk_test',
  business: {
    tz: process.env.BUSINESS_TZ || 'Asia/Kolkata',
    startHour: parseInt(process.env.BUSINESS_START_HOUR || '9', 10),
    startMinute: parseInt(process.env.BUSINESS_START_MINUTE || '30', 10),
    endHour: parseInt(process.env.BUSINESS_END_HOUR || '18', 10),
    endMinute: parseInt(process.env.BUSINESS_END_MINUTE || '30', 10),
    workingMinutesPerDay: 9 * 60, // 540 minutes
  },
};
