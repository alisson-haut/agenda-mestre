import type { Cat, Task } from './types';
import { addDays, daysInMonth, today, uid, ymd } from './dates';

export const PRESETS: Cat[] = [
  { id: 'c1', name: 'Trabalho', color: '#3B6FE0' },
  { id: 'c2', name: 'Pessoal', color: '#D2557E' },
  { id: 'c3', name: 'Estudos', color: '#7C5AD6' },
  { id: 'c4', name: 'Saúde', color: '#21A179' },
  { id: 'c5', name: 'Casa', color: '#C77B2B' },
  { id: 'c6', name: 'Financeiro', color: '#6E7B8B' },
];

export const PALETA = ['#3B6FE0','#2A94C9','#21A179','#7FA82B','#C9A227','#D07C21','#C0392B','#D2557E','#A64D9E','#7C5AD6','#5A6ACF','#6E7B8B','#0F6B57','#8C5A3C'];

/* tarefas de exemplo, só na primeira vez */
export function seed(): Task[] {
  const t0 = today();
  const d = (n: number) => ymd(addDays(t0, n));
  const base = { notes: '', subs: [], doneDates: [], done: false, remind: null } as const;
  return [
    {
      id: uid(), title: 'Planejar o trimestre', notes: 'Metas do trimestre.', cat: 'c1', cats: ['c1'], date: d(0), time: '09:00',
      dur: 60, remind: null, prio: 'alta', rec: { type: 'none', until: null },
      subs: [
        { id: uid(), t: 'Listar as metas', done: true },
        { id: uid(), t: 'Definir prazos', done: false },
        { id: uid(), t: 'Bloquear tempo na agenda', done: false },
      ],
      doneDates: [], done: false, created: Date.now(),
    },
    { ...base, id: uid(), title: 'Academia', cat: 'c4', cats: ['c4'], date: d(0), time: '19:00', dur: 60, prio: 'media', rec: { type: 'weekly', until: null }, subs: [], doneDates: [], created: Date.now() },
    {
      ...base, id: uid(), title: 'Pagar contas do mês', notes: 'Luz, água, internet.', cat: 'c6', cats: ['c6'],
      date: ymd(new Date(t0.getFullYear(), t0.getMonth(), Math.min(10, daysInMonth(t0.getFullYear(), t0.getMonth())))),
      time: null, dur: 60, prio: 'alta', rec: { type: 'monthly', until: null }, subs: [], doneDates: [], created: Date.now(),
    },
    { ...base, id: uid(), title: 'Ler 20 páginas', cat: 'c3', cats: ['c3'], date: d(1), time: '21:30', dur: 30, prio: 'baixa', rec: { type: 'daily', until: null }, subs: [], doneDates: [], created: Date.now() },
    {
      ...base, id: uid(), title: 'Ideias para o fim de semana', notes: 'Sem data ainda — arraste para um dia quando decidir.',
      cat: 'c2', cats: ['c2'], date: null, time: null, dur: 60, prio: 'baixa', rec: { type: 'none', until: null }, subs: [], doneDates: [], created: Date.now(),
    },
  ];
}
