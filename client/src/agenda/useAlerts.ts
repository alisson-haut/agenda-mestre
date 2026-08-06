/* Motor de alertas in-app: computa ocorrências devidas (hora local do
   navegador), promove um alerta por vez (fila ordenada por prioridade) e
   grava ack/snooze em prefs.alerts — sincronizado entre dispositivos pelo
   PUT /api/state já existente. */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AlertState, AppData, Prefs, Task } from './types';
import { addDays, minutesOf, parseYMD, today, ymd } from './dates';
import { isDone, occurrences } from './logic';

const TOLERANCE_MS = 15 * 60_000; // alerta "perdido" além disso não dispara
const PRIO_ORD: Record<string, number> = { alta: 0, media: 1, baixa: 2 };

export interface ActiveAlert {
  t: Task;
  dk: string;
  key: string;
  fireAt: number;
}

/* remove estados de alerta de ocorrências com mais de 7 dias */
export function pruneAlerts(prefs: Prefs) {
  const cutoff = ymd(addDays(today(), -7));
  for (const k of Object.keys(prefs.alerts)) {
    const dk = k.split('|')[1] || '';
    if (dk < cutoff) delete prefs.alerts[k];
  }
}

export function computeDue(data: AppData, now: number): ActiveAlert[] {
  const out: ActiveAlert[] = [];
  /* ontem cobre snooze/lembrete atravessando a meia-noite; amanhã cobre remind de 1 dia */
  const start = addDays(today(), -1);
  const end = addDays(today(), 1);
  for (const t of data.tasks) {
    if (!t.date || !t.time || t.remind == null) continue;
    for (const dk of occurrences(t, start, end)) {
      if (isDone(t, dk)) continue;
      const key = `${t.id}|${dk}`;
      const st = data.prefs.alerts[key];
      if (st?.s === 'ack') continue;
      const fireAt = parseYMD(dk).getTime() + (minutesOf(t.time) - t.remind) * 60_000;
      const efetivo = st?.s === 'snooze' ? st.until : fireAt;
      if (now >= efetivo && now - efetivo <= TOLERANCE_MS) out.push({ t, dk, key, fireAt });
    }
  }
  out.sort((a, b) => PRIO_ORD[a.t.prio] - PRIO_ORD[b.t.prio] || a.fireAt - b.fireAt);
  return out;
}

export function useAlerts(opts: {
  dataRef: { current: AppData | null };
  mutate(fn: (d: AppData) => void): void;
  suspended(): boolean;
}) {
  const [current, setCurrent] = useState<ActiveAlert | null>(null);
  const [queueCount, setQueueCount] = useState(0);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const currentRef = useRef<ActiveAlert | null>(null);
  currentRef.current = current;

  const check = useCallback(() => {
    const { dataRef, suspended } = optsRef.current;
    const data = dataRef.current;
    if (!data) return;
    const due = computeDue(data, Date.now());
    const cur = currentRef.current;
    if (cur && due.some((d) => d.key === cur.key)) {
      const n = due.length - 1;
      setQueueCount((q) => (q === n ? q : n));
      return;
    }
    if (!due.length) {
      if (cur) {
        setCurrent(null);
        setQueueCount(0);
      }
      return;
    }
    if (!cur && suspended()) return; // não interrompe drag/modais; próximo tick pega
    setCurrent(due[0]);
    setQueueCount(due.length - 1);
  }, []);

  /* tick periódico */
  useEffect(() => {
    const iv = window.setInterval(check, 20_000);
    return () => window.clearInterval(iv);
  }, [check]);
  /* após todo render — mutate() sempre re-renderiza, então mudanças de estado
     re-checam na hora; idempotente (só faz setState quando algo muda) */
  useEffect(() => {
    check();
  });
  /* aba/celular voltando ao primeiro plano */
  useEffect(() => {
    const h = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', h);
    return () => document.removeEventListener('visibilitychange', h);
  }, [check]);

  const resolve = useCallback((state: AlertState) => {
    const cur = currentRef.current;
    if (!cur) return;
    optsRef.current.mutate((d) => {
      d.prefs.alerts[cur.key] = state;
      pruneAlerts(d.prefs);
    });
    setCurrent(null);
    setQueueCount(0);
  }, []);

  const ack = useCallback(() => resolve({ s: 'ack' }), [resolve]);
  const snooze = useCallback(
    (mins: number) => resolve({ s: 'snooze', until: Date.now() + mins * 60_000 }),
    [resolve],
  );
  const ackForEdit = useCallback((): ActiveAlert | null => {
    const cur = currentRef.current;
    if (cur) resolve({ s: 'ack' });
    return cur;
  }, [resolve]);

  return { current, queueCount, ack, snooze, ackForEdit };
}
