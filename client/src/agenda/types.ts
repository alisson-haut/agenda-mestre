export type Prio = 'baixa' | 'media' | 'alta';
export type RecType = 'none' | 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'yearly';
export type View = 'dia' | 'semana' | 'mes' | 'trimestre' | 'ano';
export type Filter = 'todas' | 'hoje' | 'semana' | 'semdata' | 'feitas';

export interface Sub {
  id: string;
  t: string;
  done: boolean;
}
export interface Rec {
  type: RecType;
  until: string | null;
}
export interface Task {
  id: string;
  title: string;
  notes: string;
  /** etiqueta principal (primeira de `cats`) — define a cor da pílula */
  cat: string;
  /** até 4 etiquetas; a primeira é a principal */
  cats: string[];
  date: string | null;
  time: string | null;
  dur: number;
  /** lembrete: minutos antes do horário; null = sem lembrete; 0 = na hora */
  remind: number | null;
  prio: Prio;
  rec: Rec;
  subs: Sub[];
  doneDates: string[];
  done: boolean;
  created: number;
}
export interface Cat {
  id: string;
  name: string;
  color: string;
  /** ícone personalizado (data URL de imagem pequena); null/ausente = só cor */
  icon?: string | null;
}

export const MAX_CATS_POR_TAREFA = 4;
export const taskCats = (t: Task): string[] =>
  t.cats && t.cats.length ? t.cats : t.cat ? [t.cat] : [];
export type AlertState = { s: 'ack' } | { s: 'snooze'; until: number };

export interface Prefs {
  view: View;
  theme: 'light' | 'dark';
  weekStart: 0 | 1;
  hidden: string[];
  filter: Filter;
  showDone: boolean;
  /** som dos alertas in-app */
  soundEnabled: boolean;
  /** estado por ocorrência de alerta: "taskId|dk" -> ack/snooze */
  alerts: Record<string, AlertState>;
}
export interface AppData {
  tasks: Task[];
  cats: Cat[];
  prefs: Prefs;
}
export interface Inst {
  t: Task;
  dk: string;
}

export const DEFAULT_PREFS: Prefs = {
  view: 'trimestre',
  theme: 'dark',
  weekStart: 0,
  hidden: [],
  filter: 'todas',
  showDone: true,
  soundEnabled: true,
  alerts: {},
};
