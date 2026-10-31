// Dates and deadlines, driven entirely by laws.json. No state's rule is written in code.
// Pure functions: a date in, a date out. Days are counted from the day after receipt.

import type { Law, LawRule, RequesterClass } from "./lib.ts";

const MS = 86_400_000;

export const toDate = (s: string) => new Date(`${s.slice(0, 10)}T00:00:00.000Z`);
export const iso = (d: Date) => d.toISOString().slice(0, 10);
const addCalendar = (d: Date, n: number) => new Date(d.getTime() + n * MS);
export const daysBetween = (a: string, b: string) => Math.round((toDate(b).getTime() - toDate(a).getTime()) / MS);

function nthWeekday(year: number, month: number, weekday: number, n: number): Date {
  const first = new Date(Date.UTC(year, month, 1));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(year, month, 1 + offset + (n - 1) * 7));
}

function lastWeekday(year: number, month: number, weekday: number): Date {
  const last = new Date(Date.UTC(year, month + 1, 0));
  return addCalendar(last, -((last.getUTCDay() - weekday + 7) % 7));
}

/** A fixed date that falls on a weekend is observed on the nearest weekday. */
function observed(d: Date): Date {
  if (d.getUTCDay() === 6) return addCalendar(d, -1);
  if (d.getUTCDay() === 0) return addCalendar(d, 1);
  return d;
}

export function federalHolidays(year: number): Set<string> {
  const fixed = (m: number, day: number) => observed(new Date(Date.UTC(year, m, day)));
  return new Set(
    [
      fixed(0, 1), nthWeekday(year, 0, 1, 3), nthWeekday(year, 1, 1, 3), lastWeekday(year, 4, 1), fixed(5, 19), fixed(6, 4),
      nthWeekday(year, 8, 1, 1), nthWeekday(year, 9, 1, 2), fixed(10, 11), nthWeekday(year, 10, 4, 4), fixed(11, 25),
      // New Year's Day of next year can be observed on December 31 of this one.
      observed(new Date(Date.UTC(year + 1, 0, 1))),
    ].map(iso),
  );
}

export function isBusinessDay(d: Date): boolean {
  const day = d.getUTCDay();
  if (day === 0 || day === 6) return false;
  return !federalHolidays(d.getUTCFullYear()).has(iso(d));
}

export function addBusinessDays(start: string, n: number): string {
  let d = toDate(start);
  let left = n;
  while (left > 0) {
    d = addCalendar(d, 1);
    if (isBusinessDay(d)) left -= 1;
  }
  return iso(d);
}

export function addDays(start: string, n: number, unit: "business" | "calendar"): string {
  return unit === "business" ? addBusinessDays(start, n) : iso(addCalendar(toDate(start), n));
}

/**
 * Which rule applies: the requester's class and the date the agency received the request. Dates matter because laws change:
 * California moves from calendar to business days in 2027 as read, and a request is judged by when it arrived.
 */
export function ruleFor(law: Law, klass: RequesterClass, received: string): LawRule {
  const rule = law.rules.find((r) => (r.classes.includes(klass) || r.classes.includes("any")) && r.applies_from <= received && (!r.applies_until || received <= r.applies_until));
  if (rule) return rule;
  const earliest = law.rules.map((r) => r.applies_from).sort()[0];
  throw new Error(`laws.json has no ${law.name} rule for a ${klass} request received ${received} (rules start ${earliest}). Check the law for that date and add one.`);
}

export interface Deadlines {
  rule: LawRule;
  first_due: string | null;
  first_label: string;
  extended_max: string | null;
  second_due: string | null;
  checkin: string | null;
}

/** Statutory dates for a request. checkin is your own reminder where the law sets no number of days, and is never presented as a legal deadline. */
export function deadlines(law: Law, klass: RequesterClass, received: string, checkinBusinessDays: number): Deadlines {
  const rule = ruleFor(law, klass, received);
  const fr = rule.first_response;
  const first_due = fr.count !== null && fr.unit ? addDays(received, fr.count, fr.unit) : null;
  const extended_max = first_due && rule.extension ? addDays(first_due, rule.extension.count, rule.extension.unit) : null;
  const second_due = first_due && rule.second_response?.count && rule.second_response.unit ? addDays(first_due, rule.second_response.count, rule.second_response.unit) : null;
  return { rule, first_due, first_label: fr.label, extended_max, second_due, checkin: first_due ? null : addBusinessDays(received, checkinBusinessDays) };
}
