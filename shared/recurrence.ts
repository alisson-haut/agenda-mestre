/* Recorrência — expande uma tarefa nas datas concretas dentro do período.
   Compartilhado entre cliente (views do calendário) e servidor (worker de
   notificações). Interface estrutural mínima: qualquer objeto com date+rec. */
import { addDays, dayDiff, daysInMonth, parseYMD, ymd } from './dates';

export type RecType = 'none' | 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'yearly';
export interface RecLike {
  type: RecType;
  until: string | null;
}
export interface RecurringLike {
  date: string | null;
  rec: RecLike;
}

export function occurrences(t: RecurringLike, start: Date, end: Date): string[] {
  if (!t.date) return [];
  const base = parseYMD(t.date);
  const type = (t.rec && t.rec.type) || 'none';
  const until = t.rec && t.rec.until ? parseYMD(t.rec.until) : null;
  const limit = until && until < end ? until : end;
  const out: string[] = [];
  if (type === 'none') {
    if (base >= start && base <= end) out.push(t.date);
    return out;
  }
  if (base > limit) return out;

  if (type === 'daily' || type === 'weekly' || type === 'biweekly') {
    const step = type === 'daily' ? 1 : type === 'weekly' ? 7 : 14;
    const diff = dayDiff(start, base);
    let cur = addDays(base, diff > 0 ? Math.ceil(diff / step) * step : 0);
    let guard = 0;
    while (cur <= limit && guard++ < 1500) {
      out.push(ymd(cur));
      cur = addDays(cur, step);
    }
    return out;
  }
  const stepM = type === 'monthly' ? 1 : 12;
  const day = base.getDate();
  let y = base.getFullYear(),
    m = base.getMonth(),
    guard = 0;
  while (guard++ < 900) {
    const d = new Date(y, m, Math.min(day, daysInMonth(y, m)));
    if (d > limit) break;
    if (d >= start) out.push(ymd(d));
    m += stepM;
    while (m > 11) {
      m -= 12;
      y++;
    }
  }
  return out;
}
