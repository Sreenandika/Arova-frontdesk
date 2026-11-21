export interface Clock {
  now(): Date;
  iso(): string;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }

  iso(): string {
    return this.now().toISOString();
  }
}

export class ControllableClock implements Clock {
  private currentTime: Date;

  constructor(initialTime?: Date | string) {
    this.currentTime = initialTime ? new Date(initialTime) : new Date();
  }

  setTime(time: Date | string): void {
    this.currentTime = new Date(time);
  }

  advanceMinutes(minutes: number): void {
    this.currentTime = new Date(this.currentTime.getTime() + minutes * 60 * 1000);
  }

  advanceHours(hours: number): void {
    this.advanceMinutes(hours * 60);
  }

  advanceDays(days: number): void {
    this.advanceHours(days * 24);
  }

  now(): Date {
    return new Date(this.currentTime.getTime());
  }

  iso(): string {
    return this.now().toISOString();
  }
}

export const defaultClock: Clock = new SystemClock();
