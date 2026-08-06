import type { Cat, Inst, Note, Task } from './types';
import { addDays, dayDiff, daysInMonth, MES3, parseYMD, today, ymd } from './dates';

/* Contexto de leitura: tudo que os cálculos precisam do estado global */
export interface Ctx {
  tasks: Task[];
  cats: Cat[];
  hidden: string[];
  query: string;
  showDone: boolean;
  /** notas do usuário — marcadas no calendário no dia de criação */
  notes: Note[];
}

/* Recorrência — o algoritmo vive em shared/recurrence.ts (compartilhado com o
   worker de notificações do servidor); re-exportado aqui para os consumidores. */
import { occurrences } from '../../../shared/recurrence';
export { occurrences };

export const catOf = (cats: Cat[], id: string): Cat =>
  cats.find((c) => c.id === id) || { id: '', name: 'Sem etiqueta', color: '#8B928C' };

export const isDone = (t: Task, dk: string | null): boolean => (dk ? t.doneDates.includes(dk) : !!t.done);

export function toggleDone(t: Task, dk: string | null) {
  if (dk) {
    const i = t.doneDates.indexOf(dk);
    if (i >= 0) t.doneDates.splice(i, 1);
    else t.doneDates.push(dk);
  } else t.done = !t.done;
}

/* passa pelos filtros globais: busca + etiquetas ocultas.
   Com várias etiquetas, a tarefa some só quando TODAS estão ocultas. */
export function visible(ctx: Ctx, t: Task): boolean {
  const tcats = t.cats && t.cats.length ? t.cats : t.cat ? [t.cat] : [];
  if (tcats.length && tcats.every((c) => ctx.hidden.includes(c))) return false;
  if (ctx.query) {
    const names = tcats.map((id) => catOf(ctx.cats, id).name).join(' ');
    const hay = (t.title + ' ' + (t.notes || '') + ' ' + names + ' ' + t.subs.map((s) => s.t).join(' ')).toLowerCase();
    if (!hay.includes(ctx.query)) return false;
  }
  return true;
}

/* instâncias (tarefa + data concreta) dentro de um intervalo */
export function instancesIn(ctx: Ctx, start: Date, end: Date): Inst[] {
  const out: Inst[] = [];
  for (const t of ctx.tasks) {
    if (!visible(ctx, t)) continue;
    for (const dk of occurrences(t, start, end)) {
      if (!ctx.showDone && isDone(t, dk)) continue;
      out.push({ t, dk });
    }
  }
  return out;
}

export function byDay(ctx: Ctx, start: Date, end: Date): Record<string, Inst[]> {
  const map: Record<string, Inst[]> = {};
  for (const inst of instancesIn(ctx, start, end)) (map[inst.dk] = map[inst.dk] || []).push(inst);
  for (const k in map) map[k].sort(cmpInst);
  return map;
}

/* notas agrupadas por dia (dia de criação) — a busca global também filtra */
export function notesByDay(ctx: Ctx, start: Date, end: Date): Record<string, Note[]> {
  const map: Record<string, Note[]> = {};
  const a = ymd(start), b = ymd(end);
  for (const n of ctx.notes) {
    if (n.date < a || n.date > b) continue;
    if (ctx.query) {
      const hay = (n.title + ' ' + n.desc + ' ' + n.links.map((l) => l.url + ' ' + l.label).join(' ')).toLowerCase();
      if (!hay.includes(ctx.query)) continue;
    }
    (map[n.date] = map[n.date] || []).push(n);
  }
  for (const k in map) map[k].sort((x, y) => x.created - y.created);
  return map;
}

const PRIO_ORD: Record<string, number> = { alta: 0, media: 1, baixa: 2 };
export function cmpInst(a: { t: Task }, b: { t: Task }): number {
  if (!a.t.time && b.t.time) return -1;
  if (a.t.time && !b.t.time) return 1;
  if (a.t.time && b.t.time && a.t.time !== b.t.time) return a.t.time < b.t.time ? -1 : 1;
  const p = PRIO_ORD[a.t.prio] - PRIO_ORD[b.t.prio];
  return p || a.t.title.localeCompare(b.t.title, 'pt-BR');
}

/* data "representante" de uma tarefa recorrente (próxima não concluída) */
export function repDate(t: Task): string | null {
  if (!t.date) return null;
  if (t.rec.type === 'none') return t.date;
  const t0 = today();
  const occ = occurrences(t, t0, addDays(t0, 400));
  return occ.find((dk) => !t.doneDates.includes(dk)) || occ[0] || t.date;
}

export function dateLabelShort(dk: string): string {
  const d = parseYMD(dk),
    diff = dayDiff(d, today());
  if (diff === 0) return 'hoje';
  if (diff === 1) return 'amanhã';
  if (diff === -1) return 'ontem';
  if (d.getFullYear() !== today().getFullYear())
    return `${d.getDate()} ${MES3[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
  return `${d.getDate()} ${MES3[d.getMonth()]}`;
}

/* distribui eventos sobrepostos em colunas lado a lado */
export interface EvBox {
  x: Inst;
  s: number;
  e: number;
  col: number;
  cols: number;
}
export function layoutOverlaps(evs: EvBox[]): EvBox[] {
  evs.sort((a, b) => a.s - b.s || a.e - b.e);
  let cluster: EvBox[] = [],
    end = -1;
  const flush = () => {
    const cols: number[] = [];
    for (const e of cluster) {
      let c = 0;
      while (cols[c] !== undefined && cols[c] > e.s) c++;
      cols[c] = e.e;
      e.col = c;
    }
    for (const e of cluster) e.cols = cols.length;
    cluster = [];
  };
  for (const e of evs) {
    if (cluster.length && e.s >= end) flush();
    cluster.push(e);
    end = cluster.length === 1 ? e.e : Math.max(end, e.e);
  }
  if (cluster.length) flush();
  return evs;
}

export const weekStartOf = (d: Date, weekStart: number) => addDays(d, -((d.getDay() - weekStart + 7) % 7));
export const wdayOrder = (weekStart: number) => Array.from({ length: 7 }, (_, i) => (weekStart + i) % 7);
