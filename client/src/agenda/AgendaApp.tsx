import { useCallback, useEffect, useReducer, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { api, type NotePayload, type ServerState, type User } from '../api';
import type { AppData, Cat, Contact, Filter, Note, Task, View } from './types';
import { DEFAULT_PREFS, taskCats } from './types';
import { addDays, dayDiff, DIA3, DIAS, hhmmOf, MES3, MESES, parseYMD, startOfDay, today, uid, ymd } from './dates';
import { byDay, catOf, cmpInst, dateLabelShort, isDone, repDate, toggleDone, visible, weekStartOf, type Ctx } from './logic';
import { PALETA, PRESETS, seed } from './seed';
import { CatIcon, HOUR, MiniMonth, MonthView, Pill, TimeGrid } from './Views';
import { TaskModal, type TaskPayload } from './TaskModal';
import { NoteModal } from './NoteModal';
import { ContactsModal } from './ContactsModal';
import { SecretsModal } from './SecretsModal';
import { ConfirmModal, type ConfirmCfg } from './ConfirmModal';
import { CatModal } from './CatModal';
import { ConfigModal } from './ConfigModal';
import { AlertModal } from './AlertModal';
import { pruneAlerts, useAlerts } from './useAlerts';
import { sound } from './sound';
import { useHoverable, useNarrow, useToast } from './hooks';
import { BrandWordmark, LogoMark } from '../brand/Logo';

const VIEWS: { id: View; label: string; k: string }[] = [
  { id: 'dia', label: 'Dia', k: '1' },
  { id: 'semana', label: 'Semana', k: '2' },
  { id: 'mes', label: 'Mês', k: '3' },
  { id: 'trimestre', label: 'Trimestre', k: '4' },
  { id: 'ano', label: 'Ano', k: '5' },
];
const FILTERS: [Filter, string][] = [
  ['todas', 'Todas'], ['hoje', 'Hoje'], ['semana', '7 dias'], ['semdata', 'Sem data'], ['feitas', 'Feitas'],
];

function normalizeTask(t: Task): Task {
  t.rec = t.rec || { type: 'none', until: null };
  t.subs = t.subs || [];
  t.doneDates = t.doneDates || [];
  t.dur = t.dur || 60;
  t.prio = t.prio || 'media';
  t.notes = t.notes || '';
  t.cats = Array.isArray(t.cats) && t.cats.length ? t.cats.slice(0, 4) : t.cat ? [t.cat] : [];
  t.cat = t.cats[0] || '';
  t.remind = typeof t.remind === 'number' && t.remind >= 0 ? t.remind : null;
  return t;
}

function periodoLabel(anchor: Date, view: View, curto: boolean, weekStart: number): string {
  const y = anchor.getFullYear();
  const mes = (m: number) => (curto ? MES3[m] : MESES[m]);
  if (view === 'dia') {
    const dia = curto ? DIA3[anchor.getDay()] : DIAS[anchor.getDay()].replace('-feira', '');
    return `${dia}, ${anchor.getDate()} ${curto ? '' : 'de '}${mes(anchor.getMonth())} <em>${y}</em>`;
  }
  if (view === 'semana') {
    const s = weekStartOf(anchor, weekStart), e = addDays(s, 6);
    if (s.getMonth() === e.getMonth())
      return `${s.getDate()} – ${e.getDate()} ${curto ? '' : 'de '}${mes(s.getMonth())} <em>${e.getFullYear()}</em>`;
    return `${s.getDate()} ${MES3[s.getMonth()]} – ${e.getDate()} ${MES3[e.getMonth()]} <em>${e.getFullYear()}</em>`;
  }
  if (view === 'mes') return `${MESES[anchor.getMonth()]} <em>${y}</em>`;
  if (view === 'trimestre') {
    const a = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const b = new Date(a.getFullYear(), a.getMonth() + 2, 1);
    return `${mes(a.getMonth())} – ${mes(b.getMonth())} <em>${b.getFullYear()}</em>`;
  }
  return `${y}`;
}

/* o botão "Hoje" só aparece quando faz diferença */
function foraDeHoje(anchor: Date, view: View, weekStart: number): boolean {
  const t0 = today(), y = anchor.getFullYear(), m = anchor.getMonth();
  if (view === 'dia') return ymd(anchor) !== ymd(t0);
  if (view === 'semana') return ymd(weekStartOf(anchor, weekStart)) !== ymd(weekStartOf(t0, weekStart));
  if (view === 'ano') return y !== t0.getFullYear();
  if (view === 'trimestre') {
    const d = (y - t0.getFullYear()) * 12 + m - t0.getMonth();
    return d < 0 || d > 2;
  }
  return y !== t0.getFullYear() || m !== t0.getMonth();
}

function moveTask(t: Task, novaData: string, novaHora: string | null, dk: string | null) {
  if (t.rec.type !== 'none' && dk && t.date) {
    const delta = dayDiff(parseYMD(novaData), parseYMD(dk));
    if (delta) t.date = ymd(addDays(parseYMD(t.date), delta));
  } else {
    const antiga = t.date;
    t.date = novaData;
    t.doneDates = t.doneDates.map((x) => (x === antiga ? novaData : x));
  }
  t.time = novaHora;
}

interface DropInfo {
  t: Task;
  dk: string | null;
  target: HTMLElement;
}
type SheetPos = 'full' | 'mid' | 'peek';

export function AgendaApp({ user, initial, onLogout }: { user: User; initial: ServerState; onLogout(): void }) {
  /* ---------- estado central (mutável + versão) ---------- */
  const dataRef = useRef<AppData | null>(null);
  if (!dataRef.current) {
    const isNew = !initial.cats.length;
    dataRef.current = {
      cats: isNew ? PRESETS.map((c) => ({ ...c })) : initial.cats,
      tasks: (isNew ? seed() : initial.tasks).map(normalizeTask),
      prefs: { ...DEFAULT_PREFS, ...(initial.prefs || {}) },
    };
    const p = dataRef.current.prefs;
    if (!p.alerts || typeof p.alerts !== 'object') p.alerts = {};
    if (typeof p.soundEnabled !== 'boolean') p.soundEnabled = true;
    pruneAlerts(p);
  }
  const data = dataRef.current;
  const [, bump] = useReducer((x: number) => x + 1, 0);

  /* ---------- salvar (com atraso, para não gravar a cada tecla) ---------- */
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'error'>('idle');
  const pendingRef = useRef(false);
  const saveTimer = useRef<number | undefined>(undefined);
  const doSave = useCallback(async (keepalive = false) => {
    pendingRef.current = false;
    try {
      await api.putState({ cats: data.cats, tasks: data.tasks, prefs: data.prefs }, keepalive);
      setSaveStatus('idle');
    } catch (e: any) {
      if (e?.status === 401) {
        location.reload();
        return;
      }
      setSaveStatus('error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const scheduleSave = useCallback(() => {
    setSaveStatus('saving');
    pendingRef.current = true;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => doSave(), 600);
  }, [doSave]);
  const mutate = useCallback(
    (fn: (d: AppData) => void) => {
      fn(dataRef.current!);
      scheduleSave();
      bump();
    },
    [scheduleSave],
  );

  const seededRef = useRef(!initial.cats.length);
  useEffect(() => {
    if (seededRef.current) {
      seededRef.current = false;
      scheduleSave();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* descarrega alterações pendentes ao sair/minimizar */
  useEffect(() => {
    const flush = () => {
      if (pendingRef.current) {
        window.clearTimeout(saveTimer.current);
        doSave(true);
      }
    };
    const onVis = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [doSave]);

  /* ---------- estado de interface ---------- */
  const narrow = useNarrow();
  const narrowRef = useRef(narrow);
  narrowRef.current = narrow;
  const [anchor, setAnchor] = useState<Date>(() => today());
  const [selDay, setSelDay] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  /* dropdown de etiquetas sempre inicia fechado */
  const [catsOpen, setCatsOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  /* aba lateral só com mouse de verdade; touch (mesmo >=900px) usa o FAB redondo */
  const hoverable = useHoverable();
  const dockQuick = !narrow && hoverable;
  useEffect(() => { setQuickOpen(false); }, [dockQuick]);
  const toast = useToast();
  const viewportRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  /* animação de entrada: cascata topbar → viewport → lateral no 1º paint */
  const [entering, setEntering] = useState(true);
  useEffect(() => {
    const id = window.setTimeout(() => setEntering(false), 700);
    return () => window.clearTimeout(id);
  }, []);

  /* ---------- notas e contatos (CRUD próprio, fora do full-state) ---------- */
  const [notes, setNotes] = useState<Note[]>([]);
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [noteModal, setNoteModal] = useState({ open: false, session: 0, editing: null as Note | null });
  const [contactsModal, setContactsModal] = useState({ open: false, session: 0 });
  const [secretsModal, setSecretsModal] = useState({ open: false, session: 0 });
  /* confirmação central de ações destrutivas (um único modal p/ todos) */
  const [confirmModal, setConfirmModal] = useState<{ open: boolean; session: number; cfg: ConfirmCfg | null }>({
    open: false, session: 0, cfg: null,
  });
  const askConfirm = useCallback(
    (cfg: ConfirmCfg) => setConfirmModal((s) => ({ open: true, session: s.session + 1, cfg })),
    [],
  );
  const closeConfirm = () => setConfirmModal((s) => ({ ...s, open: false }));
  /* nota que está esperando a tarefa gerada (fluxo "Gerar tarefa") */
  const pendingNoteTask = useRef<string | null>(null);
  useEffect(() => {
    /* boot em paralelo, não bloqueante — sem chips no calendário se falhar */
    api.listNotes().then(setNotes).catch(() => {});
    api.listContacts().then(setContacts).catch(() => {});
  }, []);

  const view = data.prefs.view;
  const weekStart = data.prefs.weekStart;
  const theme = data.prefs.theme;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? '#0B0F12' : '#F2F4F7');
  }, [theme]);

  const ctx: Ctx = {
    tasks: data.tasks,
    cats: data.cats,
    hidden: data.prefs.hidden,
    query: query.trim().toLowerCase(),
    showDone: data.prefs.showDone,
    notes,
  };

  /* ---------- navegação ---------- */
  const [jumpSeq, setJumpSeq] = useState(0);
  const jump = useCallback(() => setJumpSeq((s) => s + 1), []);

  useEffect(() => {
    const v = data.prefs.view;
    if (v === 'dia' || v === 'semana') {
      requestAnimationFrame(() => {
        const w = document.getElementById('tgWrap');
        if (!w) return;
        const n = new Date();
        const mins = Math.min(n.getHours() * 60 + n.getMinutes(), 21 * 60);
        w.scrollTop = Math.max(0, ((mins - 80) / 60) * HOUR);
        if (v === 'semana' && narrowRef.current) {
          const col = w.querySelector('.tg-col.today') as HTMLElement | null;
          if (col) w.scrollLeft = Math.max(0, col.offsetLeft - 52 - 8);
        }
      });
    } else {
      const vp = viewportRef.current;
      if (vp) vp.scrollTop = 0;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpSeq]);

  const setView = useCallback(
    (v: View) => {
      if (v === 'dia' || v === 'semana') setSelDay(null);
      mutate((d) => {
        d.prefs.view = v;
      });
      jump();
    },
    [mutate, jump],
  );

  useEffect(() => {
    try {
      document
        .querySelector(`.view-tab[data-view="${view}"]`)
        ?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    } catch {
      /* scrollIntoView opcional */
    }
  }, [view]);

  const nav = useCallback(
    (dir: number) => {
      const v = dataRef.current!.prefs.view;
      setAnchor((a) => {
        const y = a.getFullYear(), m = a.getMonth();
        if (v === 'dia') return addDays(a, dir);
        if (v === 'semana') return addDays(a, 7 * dir);
        if (v === 'mes') return new Date(y, m + dir, 1);
        if (v === 'trimestre') return new Date(y, m + 3 * dir, 1);
        return new Date(y + dir, m, 1);
      });
      jump();
      requestAnimationFrame(() => {
        const vp = viewportRef.current;
        if (!vp) return;
        vp.classList.remove('go-l', 'go-r');
        void vp.offsetWidth;
        vp.classList.add(dir > 0 ? 'go-r' : 'go-l');
      });
    },
    [jump],
  );

  /* ---------- folha de tarefas (celular) ---------- */
  const sideRef = useRef<HTMLElement>(null);
  const gripRef = useRef<HTMLDivElement>(null);
  const sheetY = useRef({ full: 0, mid: 0, peek: 0 });
  const [sheetPos, setSheetPos] = useState<SheetPos>('peek');
  const sheetPosRef = useRef<SheetPos>('peek');

  const measureSheet = useCallback(() => {
    if (!narrowRef.current) {
      document.documentElement.style.removeProperty('--peek');
      return;
    }
    const el = sideRef.current, grip = gripRef.current;
    if (!el || !grip) return;
    const h = el.offsetHeight, gh = grip.offsetHeight;
    document.documentElement.style.setProperty('--peek', gh + 'px');
    sheetY.current = { full: 0, mid: Math.round(h * 0.46), peek: Math.max(0, h - gh) };
    el.style.setProperty('--sy', sheetY.current[sheetPosRef.current] + 'px');
  }, []);

  const sheetSet = useCallback((pos: SheetPos) => {
    if (!narrowRef.current) return;
    sheetPosRef.current = pos;
    setSheetPos(pos);
    const el = sideRef.current;
    if (!el) return;
    el.classList.remove('grabbing');
    el.style.setProperty('--sy', sheetY.current[pos] + 'px');
    document.body.classList.toggle('sheet-up', pos !== 'peek');
  }, []);

  const shState = useRef<null | { y: number; start: number; from: SheetPos; t: number; moved: boolean; lastY: number }>(null);
  const shMove = useCallback((e: PointerEvent) => {
    const sh = shState.current;
    if (!sh) return;
    const dy = e.clientY - sh.y;
    if (!sh.moved && Math.abs(dy) < 4) return;
    sh.moved = true;
    e.preventDefault();
    const y = Math.min(sheetY.current.peek, Math.max(0, sh.start + dy));
    sideRef.current?.style.setProperty('--sy', y + 'px');
    sh.lastY = y;
  }, []);
  const shUp = useCallback(() => {
    window.removeEventListener('pointermove', shMove);
    sideRef.current?.classList.remove('grabbing');
    const s = shState.current;
    if (!s) return;
    shState.current = null;
    if (!s.moved) {
      sheetSet(s.from === 'peek' ? 'mid' : 'peek');
      return;
    }
    const v = (s.lastY - s.start) / Math.max(1, Date.now() - s.t);
    let alvo: SheetPos;
    if (v > 0.55) alvo = s.from === 'full' ? 'mid' : 'peek';
    else if (v < -0.55) alvo = s.from === 'peek' ? 'mid' : 'full';
    else {
      const ys = sheetY.current;
      alvo = (['full', 'mid', 'peek'] as const).reduce((a, b) =>
        Math.abs(ys[b] - s.lastY) < Math.abs(ys[a] - s.lastY) ? b : a,
      );
    }
    sheetSet(alvo);
  }, [shMove, sheetSet]);

  const onGripDown = (e: React.PointerEvent) => {
    if (!narrow || (e.target as HTMLElement).closest('#btnNewSheet')) return;
    shState.current = {
      y: e.clientY,
      start: sheetY.current[sheetPosRef.current],
      from: sheetPosRef.current,
      t: Date.now(),
      moved: false,
      lastY: sheetY.current[sheetPosRef.current],
    };
    sideRef.current?.classList.add('grabbing');
    window.addEventListener('pointermove', shMove, { passive: false });
    window.addEventListener('pointerup', shUp, { once: true });
    window.addEventListener('pointercancel', shUp, { once: true });
  };

  useEffect(() => {
    measureSheet();
    if (!narrow) {
      setSelDay(null);
      document.body.classList.remove('sheet-up');
    } else {
      sheetSet(sheetPosRef.current);
    }
  }, [narrow, measureSheet, sheetSet]);

  useEffect(() => {
    let rz: number | undefined;
    const onRz = () => {
      window.clearTimeout(rz);
      rz = window.setTimeout(() => measureSheet(), 160);
    };
    window.addEventListener('resize', onRz);
    window.addEventListener('orientationchange', onRz);
    (document as any).fonts?.ready?.then?.(() => measureSheet());
    return () => {
      window.removeEventListener('resize', onRz);
      window.removeEventListener('orientationchange', onRz);
    };
  }, [measureSheet]);

  /* ---------- modais ---------- */
  const [taskModal, setTaskModal] = useState({
    open: false, session: 0, editing: null as Task | null, dk: null as string | null,
    pre: {} as { date?: string | null; time?: string | null },
  });
  const [catModal, setCatModal] = useState({ open: false, session: 0, editing: null as Cat | null });
  const [cfgModal, setCfgModal] = useState({ open: false, session: 0 });
  const [profile, setProfile] = useState<User>(user);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [injectCat, setInjectCat] = useState<string | null>(null);

  /* fecha o menu do perfil ao clicar fora */
  useEffect(() => {
    if (!menuOpen) return;
    const h = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [menuOpen]);
  useEffect(() => {
    if (injectCat) setInjectCat(null);
  }, [injectCat]);

  const openTask = useCallback((t: Task, dk: string | null) => {
    toast.hide();
    setTaskModal((s) => ({ open: true, session: s.session + 1, editing: t, dk, pre: {} }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const openNew = useCallback(
    (pre: { date?: string | null; time?: string | null; title?: string; notes?: string } = {}) => {
      toast.hide();
      setTaskModal((s) => ({ open: true, session: s.session + 1, editing: null, dk: null, pre }));
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [],
  );
  const closeTask = () => setTaskModal((s) => ({ ...s, open: false }));
  const openCat = (c: Cat | null) => {
    toast.hide();
    setCatModal((s) => ({ open: true, session: s.session + 1, editing: c }));
  };
  const closeCat = () => setCatModal((s) => ({ ...s, open: false }));

  const saveTask = (payload: TaskPayload, editing: Task | null) => {
    let novaId: string | null = null;
    mutate((d) => {
      if (editing) {
        if (editing.date !== payload.date) editing.doneDates = [];
        /* mudou data/hora/lembrete → re-arma os alertas desta tarefa
           (limpa acks/snoozes para o modal disparar no novo horário) */
        if (editing.date !== payload.date || editing.time !== payload.time || editing.remind !== payload.remind) {
          for (const k of Object.keys(d.prefs.alerts))
            if (k.startsWith(editing.id + '|')) delete d.prefs.alerts[k];
        }
        Object.assign(editing, payload);
      } else {
        const nt = { id: uid(), doneDates: [], done: false, created: Date.now(), ...payload };
        d.tasks.push(nt);
        novaId = nt.id;
      }
    });
    closeTask();
    /* tarefa nascida de uma nota → grava o vínculo frouxo na nota */
    const noteId = pendingNoteTask.current;
    if (noteId && novaId) {
      pendingNoteTask.current = null;
      const n = notes.find((x) => x.id === noteId);
      if (n) {
        const atualizada = { ...n, taskId: novaId };
        setNotes((arr) => arr.map((x) => (x.id === noteId ? atualizada : x)));
        api
          .updateNote(noteId, {
            title: atualizada.title, desc: atualizada.desc, date: atualizada.date,
            links: atualizada.links, contactIds: atualizada.contactIds, taskId: novaId,
          })
          .catch(() => {});
      }
      toast.show('Tarefa criada a partir da nota');
      return;
    }
    pendingNoteTask.current = null;
    toast.show(editing ? 'Tarefa atualizada' : 'Tarefa criada');
  };

  const deleteTask = () => {
    const t = taskModal.editing;
    if (!t) return;
    askConfirm({
      title: 'Excluir tarefa',
      msg: `Excluir a tarefa "${t.title}"?`,
      confirmLabel: 'Excluir',
      danger: true,
      onConfirm: () => {
        const i = data.tasks.indexOf(t);
        mutate((d) => {
          d.tasks.splice(i, 1);
          for (const k of Object.keys(d.prefs.alerts)) if (k.startsWith(t.id + '|')) delete d.prefs.alerts[k];
        });
        closeTask();
        toast.show(`"${t.title}" foi excluída`, () =>
          mutate((d) => {
            d.tasks.splice(i, 0, t);
          }),
        );
      },
    });
  };

  /* ---------- notas ---------- */
  const openNoteNew = () => {
    toast.hide();
    setNoteModal((s) => ({ open: true, session: s.session + 1, editing: null }));
  };
  const openNote = (id: string) => {
    const n = notes.find((x) => x.id === id);
    if (!n) return;
    toast.hide();
    setNoteModal((s) => ({ open: true, session: s.session + 1, editing: n }));
  };
  const closeNote = () => setNoteModal((s) => ({ ...s, open: false }));

  const saveNote = async (payload: NotePayload, editing: Note | null, gerarTarefa = false) => {
    try {
      const salva = editing
        ? await api.updateNote(editing.id, {
            title: payload.title, desc: payload.desc, date: payload.date,
            links: payload.links, contactIds: payload.contactIds, taskId: payload.taskId,
          })
        : await api.createNote(payload);
      setNotes((arr) => (editing ? arr.map((x) => (x.id === salva.id ? salva : x)) : [salva, ...arr]));
      closeNote();
      if (gerarTarefa) {
        pendingNoteTask.current = salva.id;
        const resumo = salva.desc ? salva.desc.split('\n')[0].slice(0, 200) : '';
        openNew({
          date: salva.date,
          title: salva.title || 'Tarefa da nota',
          notes: resumo ? `Da nota: ${resumo}` : '',
        });
      } else {
        toast.show(editing ? 'Nota atualizada' : 'Nota criada');
      }
    } catch (e: any) {
      if (e?.status === 401) { location.reload(); return; }
      toast.show(e?.message || 'Não consegui salvar a nota');
    }
  };

  const deleteNote = () => {
    const n = noteModal.editing;
    if (!n) return;
    askConfirm({
      title: 'Excluir nota',
      msg: n.files.length
        ? `Excluir a nota e ${n.files.length} arquivo(s)? Os arquivos são apagados definitivamente.`
        : 'Excluir esta nota?',
      confirmLabel: 'Excluir',
      danger: true,
      onConfirm: async () => {
        await api.deleteNote(n.id); /* falha → erro inline, nota permanece */
        closeNote();
        setNotes((arr) => arr.filter((x) => x.id !== n.id));
        if (n.files.length) {
          /* mídia foi apagada do storage — não há undo honesto */
          toast.show(`Nota e ${n.files.length} arquivo(s) excluídos`);
        } else {
          const payload: NotePayload = {
            id: n.id, title: n.title, desc: n.desc, date: n.date,
            links: n.links, contactIds: n.contactIds, taskId: n.taskId,
          };
          toast.show('Nota excluída', () => {
            api.createNote(payload).then((volta) => setNotes((arr) => [volta, ...arr])).catch(() => {});
          });
        }
      },
    });
  };

  const saveCat = (name: string, color: string, icon: string | null) => {
    const c = catModal.editing;
    if (c) {
      mutate(() => {
        c.name = name;
        c.color = color;
        c.icon = icon;
      });
    } else {
      const nova: Cat = { id: uid(), name, color, icon };
      mutate((d) => {
        d.cats.push(nova);
      });
      setInjectCat(nova.id);
    }
    closeCat();
  };

  const deleteCat = () => {
    const c = catModal.editing;
    if (!c) return;
    const afetadas = data.tasks.filter((t) => taskCats(t).includes(c.id)).length;
    mutate((d) => {
      d.tasks.forEach((t) => {
        t.cats = taskCats(t).filter((x) => x !== c.id);
        t.cat = t.cats[0] || '';
      });
      d.cats = d.cats.filter((x) => x.id !== c.id);
      d.prefs.hidden = d.prefs.hidden.filter((h) => h !== c.id);
    });
    closeCat();
    toast.show(afetadas ? `Etiqueta excluída · ${afetadas} tarefa(s) ficaram sem etiqueta` : 'Etiqueta excluída');
  };

  /* ---------- arrastar e soltar ---------- */
  const dragActiveRef = useRef(false);

  /* ---------- alertas de lembrete ---------- */
  const alerts = useAlerts({
    dataRef,
    mutate,
    suspended: () =>
      taskModal.open || catModal.open || cfgModal.open || noteModal.open || contactsModal.open ||
      secretsModal.open || confirmModal.open || dragActiveRef.current,
  });
  /* o primeiro toque em qualquer lugar libera o AudioContext para os alertas */
  useEffect(() => {
    const h = () => sound.unlock();
    document.addEventListener('pointerdown', h, { once: true, capture: true });
    return () => document.removeEventListener('pointerdown', h, true);
  }, []);

  const applyDrop = useCallback(
    (d: DropInfo) => {
      const t = d.t;
      const antes = { date: t.date, time: t.time, doneDates: [...t.doneDates], rec: { ...t.rec } };
      const desfazer = () =>
        mutate(() => {
          t.date = antes.date;
          t.time = antes.time;
          t.doneDates = antes.doneDates;
          t.rec = antes.rec;
        });
      if (d.target.hasAttribute('data-drop-nodate')) {
        if (!t.date) return;
        mutate(() => {
          t.date = null;
          t.time = null;
          t.rec = { type: 'none', until: null };
        });
        toast.show(`"${t.title}" voltou para a lista sem data`, desfazer);
      } else if (d.target.hasAttribute('data-slot')) {
        const k = d.target.dataset.slot!, hm = hhmmOf(+d.target.dataset.min!);
        if (t.date === k && t.time === hm) return;
        mutate(() => moveTask(t, k, hm, d.dk));
        toast.show(`"${t.title}" → ${dateLabelShort(k)}, ${hm}${t.rec.type !== 'none' ? ' (série inteira)' : ''}`, desfazer);
      } else {
        const k = d.target.dataset.dropDay!;
        const semHora = !!d.target.closest('.tg-allcol');
        if (t.date === k && !semHora) return;
        mutate(() => moveTask(t, k, semHora ? null : t.time, d.dk));
        toast.show(`"${t.title}" → ${dateLabelShort(k)}${t.rec.type !== 'none' ? ' (série inteira)' : ''}`, desfazer);
      }
      navigator.vibrate?.(14);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mutate],
  );

  const handlersRef = useRef({ narrow, openTask, applyDrop, sheetSet });
  handlersRef.current = { narrow, openTask, applyDrop, sheetSet };

  useEffect(() => {
    interface DragState {
      el: HTMLElement; t: Task; dk: string | null; sx: number; sy: number;
      active: boolean; ghost: HTMLElement | null; target: HTMLElement | null;
      toque: boolean; pronto: boolean; timer: number | null; ox: number; oy: number;
    }
    let drag: DragState | null = null;

    const autoScroll = (y: number) => {
      const alvos = [document.getElementById('viewport'), document.getElementById('tgWrap')].filter(
        Boolean,
      ) as HTMLElement[];
      for (const el of alvos) {
        const r = el.getBoundingClientRect();
        if (y < r.top + 56 && y > r.top - 40) el.scrollTop -= 11;
        else if (y > r.bottom - 56 && y < r.bottom + 40) el.scrollTop += 11;
      }
    };

    const onMove = (e: PointerEvent) => {
      if (!drag) return;
      const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (!drag.pronto) {
        if (Math.hypot(dx, dy) > 8) {
          if (drag.timer) window.clearTimeout(drag.timer);
          drag = null;
          window.removeEventListener('pointermove', onMove);
        }
        return;
      }
      if (!drag.active) {
        if (Math.hypot(dx, dy) < 6) return;
        drag.active = true;
        dragActiveRef.current = true;
        document.body.classList.add('dragging');
        drag.el.classList.add('lifting');
        const r = drag.el.getBoundingClientRect();
        const g = drag.el.cloneNode(true) as HTMLElement;
        g.classList.add('drag-ghost');
        g.classList.remove('lifting');
        g.style.width = Math.min(280, Math.max(170, r.width)) + 'px';
        g.style.height = 'auto';
        g.style.left = r.left + 'px';
        g.style.top = r.top + 'px';
        document.body.appendChild(g);
        drag.ghost = g;
        drag.ox = Math.min(e.clientX - r.left, 240);
        drag.oy = e.clientY - r.top;
        const H = handlersRef.current;
        if (H.narrow && drag.el.closest('#side')) H.sheetSet('peek');
      }
      e.preventDefault();
      drag.ghost!.style.left = e.clientX - drag.ox + 'px';
      drag.ghost!.style.top = e.clientY - drag.oy + 'px';
      drag.ghost!.style.visibility = 'hidden';
      const under = document.elementFromPoint(e.clientX, e.clientY);
      drag.ghost!.style.visibility = '';
      const tgt = under
        ? (under.closest('[data-slot],[data-drop-day],[data-drop-nodate]') as HTMLElement | null)
        : null;
      if (tgt !== drag.target) {
        if (drag.target) drag.target.classList.remove('drop-ok');
        drag.target = tgt;
        if (tgt) tgt.classList.add('drop-ok');
      }
      autoScroll(e.clientY);
    };

    const onEnd = () => {
      window.removeEventListener('pointermove', onMove);
      if (!drag) return;
      const d = drag;
      drag = null;
      dragActiveRef.current = false;
      if (d.timer) window.clearTimeout(d.timer);
      document.body.classList.remove('dragging');
      if (d.ghost) d.ghost.remove();
      d.el.classList.remove('lifting');
      if (d.target) d.target.classList.remove('drop-ok');
      const H = handlersRef.current;
      if (!d.active) {
        H.openTask(d.t, d.dk);
        return;
      }
      if (d.target) H.applyDrop({ t: d.t, dk: d.dk, target: d.target });
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== undefined && e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.closest('[data-act="toggle"]')) return;
      const el = target.closest('[data-drag]') as HTMLElement | null;
      if (!el) return;
      const t = dataRef.current!.tasks.find((x) => x.id === el.dataset.id);
      if (!t) return;
      const toque = e.pointerType === 'touch';
      drag = {
        el, t, dk: el.dataset.dk || null, sx: e.clientX, sy: e.clientY,
        active: false, ghost: null, target: null, toque, pronto: !toque, timer: null, ox: 0, oy: 0,
      };
      if (toque)
        drag.timer = window.setTimeout(() => {
          if (drag) {
            drag.pronto = true;
            navigator.vibrate?.(9);
          }
        }, 300);
      window.addEventListener('pointermove', onMove, { passive: false });
      window.addEventListener('pointerup', onEnd, { once: true });
      window.addEventListener('pointercancel', onEnd, { once: true });
    };

    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- deslizar para mudar de período ---------- */
  const swRef = useRef<{ x: number; y: number; ok: boolean } | null>(null);
  const swDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') return;
    swRef.current = { x: e.clientX, y: e.clientY, ok: false };
  };
  const swMove = (e: React.PointerEvent) => {
    const sw = swRef.current;
    if (!sw) return;
    if (dragActiveRef.current) {
      swRef.current = null;
      return;
    }
    const dx = e.clientX - sw.x, dy = e.clientY - sw.y;
    if (!sw.ok && Math.abs(dx) > 30 && Math.abs(dx) > Math.abs(dy) * 1.7) sw.ok = true;
  };
  const swUp = (e: React.PointerEvent) => {
    const sw = swRef.current;
    if (sw && sw.ok && !dragActiveRef.current) nav(e.clientX - sw.x < 0 ? 1 : -1);
    swRef.current = null;
  };

  /* ---------- cliques no calendário ---------- */
  const escolherDia = (k: string) => {
    setSelDay(k);
    sheetSet('mid');
  };

  const viewportClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const chk = target.closest('[data-act="toggle"]');
    if (chk) {
      const pEl = chk.closest('[data-id]') as HTMLElement;
      const t = data.tasks.find((x) => x.id === pEl.dataset.id);
      if (t) mutate(() => toggleDone(t, pEl.dataset.dk || null));
      return;
    }
    /* chip de nota — ANTES do handler genérico da célula do dia */
    const nc = target.closest('[data-open-note]') as HTMLElement | null;
    if (nc) {
      openNote(nc.dataset.openNote!);
      return;
    }
    if (target.closest('[data-drag]')) return;
    const more = target.closest('.more') as HTMLElement | null;
    if (more) {
      setAnchor(parseYMD(more.dataset.openday!));
      setView('dia');
      return;
    }
    const od = target.closest('[data-openday]') as HTMLElement | null;
    if (od) {
      setAnchor(parseYMD(od.dataset.openday!));
      setSelDay(null);
      setView('dia');
      return;
    }
    const om = target.closest('[data-openmonth]') as HTMLElement | null;
    if (om) {
      setAnchor(parseYMD(om.dataset.openmonth!));
      setView('mes');
      return;
    }
    const md = target.closest('.mini-day') as HTMLElement | null;
    if (md) {
      if (narrow) escolherDia(md.dataset.day!);
      else {
        setAnchor(parseYMD(md.dataset.day!));
        setView('dia');
      }
      return;
    }
    const add = target.closest('[data-act="add"]') as HTMLElement | null;
    if (add) {
      openNew({ date: add.dataset.day });
      return;
    }
    const slot = target.closest('[data-slot]') as HTMLElement | null;
    if (slot) {
      openNew({ date: slot.dataset.slot, time: hhmmOf(+slot.dataset.min!) });
      return;
    }
    const ac = target.closest('.tg-allcol') as HTMLElement | null;
    if (ac) {
      openNew({ date: ac.dataset.dropDay });
      return;
    }
    const cell = target.closest('.cell') as HTMLElement | null;
    if (cell) {
      if (narrow) escolherDia(cell.dataset.day!);
      else openNew({ date: cell.dataset.day });
    }
  };

  /* ---------- cliques na folha / lateral ---------- */
  const sideClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const chk = target.closest('[data-act="toggle"]');
    if (chk) {
      const pEl = chk.closest('[data-id]') as HTMLElement;
      const t = data.tasks.find((x) => x.id === pEl.dataset.id);
      if (t) mutate(() => toggleDone(t, pEl.dataset.dk || null));
      return;
    }
    if (target.closest('[data-act="clearsel"]')) {
      setSelDay(null);
      return;
    }
    if (target.closest('[data-act="addsel"]')) {
      openNew({ date: selDay });
      return;
    }
    const od = target.closest('[data-openday]') as HTMLElement | null;
    if (od) {
      setAnchor(parseYMD(od.dataset.openday!));
      setSelDay(null);
      sheetSet('peek');
      setView('dia');
      return;
    }
    const tc = target.closest('[data-act="togglecat"]') as HTMLElement | null;
    if (tc) {
      const id = (tc.closest('[data-cat]') as HTMLElement).dataset.cat!;
      mutate((d) => {
        const i = d.prefs.hidden.indexOf(id);
        if (i >= 0) d.prefs.hidden.splice(i, 1);
        else d.prefs.hidden.push(id);
      });
      return;
    }
    const ec = target.closest('[data-act="editcat"]') as HTMLElement | null;
    if (ec) {
      const id = (ec.closest('[data-cat]') as HTMLElement).dataset.cat!;
      openCat(data.cats.find((c) => c.id === id) || null);
    }
  };

  /* ---------- atalhos de teclado ---------- */
  const novaTarefaAqui = useCallback(() => {
    openNew({ date: selDay || ymd(dataRef.current!.prefs.view === 'dia' ? anchor : today()) });
  }, [openNew, selDay, anchor]);

  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e: KeyboardEvent) => {
    const digitando = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement).tagName);
    /* com um alerta na tela, Escape prorroga 10 min e os demais atalhos param */
    if (alerts.current) {
      if (e.key === 'Escape') {
        e.preventDefault();
        alerts.snooze(10);
      }
      return;
    }
    if (e.key === 'Escape') {
      /* topo-primeiro: fecha só o modal mais alto da pilha e para
         (câmera e viewer interceptam o próprio Escape antes de chegar aqui) */
      if (confirmModal.open) { closeConfirm(); return; }
      if (secretsModal.open) { setSecretsModal((s) => ({ ...s, open: false })); return; }
      if (contactsModal.open) { setContactsModal((s) => ({ ...s, open: false })); return; }
      if (noteModal.open) { setNoteModal((s) => ({ ...s, open: false })); return; }
      closeTask();
      closeCat();
      setCfgModal((s) => ({ ...s, open: false }));
      setMenuOpen(false);
      setQuickOpen(false);
      sheetSet('peek');
      return;
    }
    const modalAberto =
      taskModal.open || catModal.open || cfgModal.open || noteModal.open || contactsModal.open ||
      secretsModal.open || confirmModal.open;
    if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
      if (modalAberto) return;
      e.preventDefault();
      searchRef.current?.focus();
      return;
    }
    if (digitando || modalAberto) return;
    if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      novaTarefaAqui();
    } else if (e.key === 't' || e.key === 'T') {
      setAnchor(today());
      jump();
    } else if (e.key === '/') {
      e.preventDefault();
      searchRef.current?.focus();
    } else if (e.key === 'ArrowLeft') nav(-1);
    else if (e.key === 'ArrowRight') nav(1);
    else if ('12345'.includes(e.key)) setView(VIEWS[+e.key - 1].id);
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e);
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, []);

  const resetAll = () => {
    askConfirm({
      title: 'Apagar tudo',
      msg: 'Isso apaga TODAS as suas tarefas e devolve as etiquetas originais. Notas, contatos e arquivos não são afetados. Digite a senha da conta para confirmar.',
      confirmLabel: 'Apagar tudo',
      danger: true,
      askPassword: true,
      hint: 'Entrou com o Google e nunca criou senha? Defina uma pelo "Esqueci minha senha" na tela de entrada.',
      onConfirm: async (senha) => {
        await api.verifyPassword(senha || ''); /* 401/429 → erro inline no modal */
        mutate((d) => {
          d.tasks = [];
          d.cats = PRESETS.map((c) => ({ ...c }));
          d.prefs.hidden = [];
          d.prefs.filter = 'todas';
        });
        setSelDay(null);
        toast.show('Tudo apagado');
      },
    });
  };

  /* ---------- dados derivados para a lateral ---------- */
  const t0 = today();
  const catCounts: Record<string, number> = {};
  data.tasks.forEach((t) => {
    for (const id of taskCats(t)) catCounts[id] = (catCounts[id] || 0) + 1;
  });
  const abrirCats = catsOpen;

  const rows = data.tasks.filter((t) => visible(ctx, t)).map((t) => ({ t, dk: repDate(t) }));
  const cnt: Record<Filter, number> = { todas: 0, hoje: 0, semana: 0, semdata: 0, feitas: 0 };
  rows.forEach((r) => {
    const done = isDone(r.t, r.dk);
    if (done) {
      cnt.feitas++;
      return;
    }
    cnt.todas++;
    if (!r.dk) {
      cnt.semdata++;
      return;
    }
    const d = dayDiff(parseYMD(r.dk), t0);
    if (d === 0) cnt.hoje++;
    if (d >= 0 && d <= 6) cnt.semana++;
  });

  const f = data.prefs.filter;
  const keep = rows.filter((r) => {
    const done = isDone(r.t, r.dk);
    if (f === 'feitas') return done;
    if (done) return false;
    if (f === 'semdata') return !r.dk;
    if (f === 'hoje') return r.dk !== null && dayDiff(parseYMD(r.dk), t0) === 0;
    if (f === 'semana') {
      if (!r.dk) return false;
      const d = dayDiff(parseYMD(r.dk), t0);
      return d >= 0 && d <= 6;
    }
    return true;
  });

  const groupDefs: { k: string; label: string; test: (r: { t: Task; dk: string | null }) => boolean }[] = [
    { k: 'atrasadas', label: 'Atrasadas', test: (r) => r.dk !== null && dayDiff(parseYMD(r.dk), t0) < 0 },
    { k: 'hoje', label: 'Hoje', test: (r) => r.dk !== null && dayDiff(parseYMD(r.dk), t0) === 0 },
    { k: 'amanha', label: 'Amanhã', test: (r) => r.dk !== null && dayDiff(parseYMD(r.dk), t0) === 1 },
    {
      k: 'semana', label: 'Próximos 7 dias',
      test: (r) => {
        if (!r.dk) return false;
        const d = dayDiff(parseYMD(r.dk), t0);
        return d >= 2 && d <= 7;
      },
    },
    { k: 'depois', label: 'Mais adiante', test: (r) => r.dk !== null && dayDiff(parseYMD(r.dk), t0) > 7 },
    { k: 'semdata', label: 'Sem data', test: (r) => !r.dk },
  ];
  const groups = groupDefs
    .map((g) => ({
      ...g,
      items: keep
        .filter(g.test)
        .sort((a, b) => {
          if (a.dk && b.dk && a.dk !== b.dk) return a.dk < b.dk ? -1 : 1;
          return cmpInst({ t: a.t }, { t: b.t });
        }),
    }))
    .filter((g) => {
      if (!g.items.length && g.k !== 'semdata') return false;
      if (!g.items.length && g.k === 'semdata' && f !== 'todas' && f !== 'semdata') return false;
      return true;
    });

  /* resumo da alça da folha */
  let gripTitle = 'Tarefas';
  let gripSub = '';
  {
    const tk = ymd(t0);
    let hoje = 0, atras = 0;
    for (const t of data.tasks) {
      const dk = repDate(t);
      if (isDone(t, dk)) continue;
      if (dk === tk) hoje++;
      else if (dk && dk < tk) atras++;
    }
    if (selDay && narrow) {
      const d = parseYMD(selDay);
      const n = (byDay(ctx, d, d)[selDay] || []).length;
      gripTitle = `${DIA3[d.getDay()]}, ${d.getDate()} de ${MESES[d.getMonth()]}`;
      gripSub = n ? `${n} ${n > 1 ? 'tarefas' : 'tarefa'} neste dia` : 'nada marcado neste dia';
    } else {
      gripSub = `${hoje} para hoje` + (atras ? ` · <b>${atras} atrasada${atras > 1 ? 's' : ''}</b>` : '');
    }
  }

  /* ---------- conteúdo da visão ---------- */
  let viewContent: ReactNode;
  if (view === 'mes') {
    viewContent = <MonthView ctx={ctx} anchor={anchor} selDay={selDay} weekStart={weekStart} narrow={narrow} />;
  } else if (view === 'trimestre') {
    const a = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    viewContent = (
      <div className="quarter">
        {[0, 1, 2].map((i) => {
          const m = new Date(a.getFullYear(), a.getMonth() + i, 1);
          return <MiniMonth key={ymd(m)} mDate={m} ctx={ctx} weekStart={weekStart} selDay={selDay} fixed6 />;
        })}
      </div>
    );
  } else if (view === 'ano') {
    const y = anchor.getFullYear();
    viewContent = (
      <>
        <div className="legend">
          Densidade do ano
          <i className="heat0" /><i className="heat1" /><i className="heat2" /><i className="heat3" /><i className="heat4" />
          <span>4+ no dia</span>
        </div>
        <div className="year">
          {Array.from({ length: 12 }, (_, m) => (
            <MiniMonth key={m} mDate={new Date(y, m, 1)} ctx={ctx} weekStart={weekStart} selDay={selDay} heat />
          ))}
        </div>
      </>
    );
  } else if (view === 'semana') {
    const s = weekStartOf(anchor, weekStart);
    viewContent = (
      <TimeGrid days={Array.from({ length: 7 }, (_, i) => addDays(s, i))} ctx={ctx} weekStart={weekStart} narrow={narrow} />
    );
  } else {
    viewContent = <TimeGrid days={[startOfDay(anchor)]} ctx={ctx} weekStart={weekStart} narrow={narrow} />;
  }

  const fora = foraDeHoje(anchor, view, weekStart);

  return (
    <>
      <div className={`app ${entering ? 'app-enter' : ''}`}>
        <header className="topbar">
          <div className="top-row">
            <div className="brand">
              <LogoMark size={26} tone="gradient" title="AgendaMestre" />
              <BrandWordmark />
            </div>
            <div className="navgroup">
              <button className="iconbtn" onClick={() => nav(-1)} aria-label="Período anterior"><svg><use href="#i-prev" /></svg></button>
              <button className="iconbtn" onClick={() => nav(1)} aria-label="Próximo período"><svg><use href="#i-next" /></svg></button>
            </div>
            <button
              className={`btn-today ${fora ? 'on' : ''}`}
              onClick={() => {
                setAnchor(today());
                setSelDay(null);
                jump();
              }}
            >
              Hoje
            </button>
            <h1 className="periodo" dangerouslySetInnerHTML={{ __html: periodoLabel(anchor, view, narrow, weekStart) }} />
            <nav className="views" role="tablist" aria-label="Formato de visualização">
              {VIEWS.map((v) => (
                <button key={v.id} className="view-tab" role="tab" data-view={v.id} aria-selected={view === v.id} onClick={() => setView(v.id)}>
                  {v.label}<kbd>{v.k}</kbd>
                </button>
              ))}
            </nav>
            <button
              className="iconbtn"
              onClick={() => mutate((d) => { d.prefs.theme = d.prefs.theme === 'dark' ? 'light' : 'dark'; })}
              aria-label="Alternar tema claro e escuro"
            >
              <svg><use href={theme === 'dark' ? '#i-sun' : '#i-moon'} /></svg>
            </button>
            <div className="usermenu" ref={menuRef}>
              <button
                className="avatar"
                onClick={() => setMenuOpen((o) => !o)}
                aria-label="Perfil e configurações"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                title={profile.email}
              >
                {profile.avatar ? (
                  <img src={profile.avatar} alt="" draggable={false} />
                ) : (
                  (profile.name || profile.email).charAt(0).toUpperCase()
                )}
              </button>
              {menuOpen && (
                <div className="menu-pop" role="menu">
                  <div className="menu-user">
                    <div className="menu-name">{profile.name || 'Sem nome'}</div>
                    <div className="menu-mail">{profile.email}</div>
                  </div>
                  <button
                    className="menu-item"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      toast.hide();
                      setCfgModal((s) => ({ open: true, session: s.session + 1 }));
                    }}
                  >
                    <svg><use href="#i-gear" /></svg> Configurações
                  </button>
                  <button className="menu-item danger" role="menuitem" onClick={onLogout}>
                    <svg><use href="#i-logout" /></svg> Sair
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="main">
          <div
            id="viewport"
            className="viewport"
            ref={viewportRef}
            onClick={viewportClick}
            onPointerDown={swDown}
            onPointerMove={swMove}
            onPointerUp={swUp}
            onPointerCancel={() => (swRef.current = null)}
          >
            {viewContent}
          </div>
        </main>

        <aside className="side" id="side" aria-label="Tarefas" ref={sideRef}>
          <div className="grip" id="grip" ref={gripRef} onPointerDown={onGripDown}>
            <div className="grip-bar" />
            <div className="grip-row">
              <button className="grip-txt" style={{ textAlign: 'left' }} aria-expanded={sheetPos !== 'peek'} onClick={(e) => e.preventDefault()}>
                <div className="grip-title">{gripTitle}</div>
                <div className="grip-sub" dangerouslySetInnerHTML={{ __html: gripSub }} />
              </button>
              <button className="grip-add" id="btnNewSheet" aria-label="Nova tarefa" onClick={novaTarefaAqui}>
                <svg><use href="#i-plus" /></svg>
              </button>
            </div>
          </div>
          <div className="side-top">
            <label className="search">
              <svg><use href="#i-search" /></svg>
              <input
                ref={searchRef}
                type="search"
                placeholder="Buscar tarefa..."
                autoComplete="off"
                aria-label="Buscar tarefa"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onFocus={() => {
                  if (sheetPosRef.current === 'peek') sheetSet('full');
                }}
              />
              <kbd className="search-kbd">⌘K</kbd>
            </label>
            <div className="chips" role="group" aria-label="Filtros">
              {FILTERS.map(([fk, label]) => (
                <button key={fk} className="chip" aria-pressed={f === fk} onClick={() => mutate((d) => { d.prefs.filter = fk; })}>
                  {label} <b>{cnt[fk]}</b>
                </button>
              ))}
            </div>
          </div>
          <div className="side-scroll" onClick={sideClick}>
            {selDay && narrow && (() => {
              const d = parseYMD(selDay);
              const items = byDay(ctx, d, d)[selDay] || [];
              return (
                <div className="daypanel">
                  <div className="daypanel-head">
                    <h3>
                      <button data-openday={selDay} style={{ font: 'inherit', color: 'inherit' }}>
                        {DIA3[d.getDay()]}, {d.getDate()} de {MESES[d.getMonth()]}
                      </button>
                    </h3>
                    <button className="daypanel-close" data-act="clearsel" aria-label="Limpar dia escolhido">
                      <svg><use href="#i-close" /></svg>
                    </button>
                  </div>
                  <div className="daypanel-list">
                    {items.length ? (
                      items.map((x) => <Pill key={x.t.id + x.dk} t={x.t} dk={x.dk} variant="allday" cats={data.cats} />)
                    ) : (
                      <div className="empty" style={{ padding: '6px 0 12px', textAlign: 'left' }}>Nada marcado neste dia ainda.</div>
                    )}
                  </div>
                  <button className="daypanel-add" data-act="addsel">
                    <svg><use href="#i-plus" /></svg> Nova tarefa neste dia
                  </button>
                </div>
              );
            })()}
            <div className="sec">
              <div className="sec-title">
                <button className="sec-toggle" aria-expanded={abrirCats} aria-controls="cats" onClick={() => setCatsOpen(!abrirCats)}>
                  <svg className="chev"><use href="#i-next" /></svg> Etiquetas <b>{abrirCats ? '' : data.cats.length}</b>
                </button>
                <button className="sec-add" aria-label="Criar etiqueta" onClick={() => openCat(null)}>+</button>
              </div>
              {abrirCats && (
                <div className="cats" id="cats">
                  {data.cats.length ? (
                    data.cats.map((c) => (
                      <div
                        key={c.id}
                        className={`cat ${data.prefs.hidden.includes(c.id) ? 'off' : ''}`}
                        style={{ '--c': c.color } as CSSProperties}
                        data-cat={c.id}
                      >
                        <button className="cat-icbtn" data-act="togglecat" aria-label={`Mostrar ou ocultar ${c.name}`}>
                          <CatIcon cat={c} />
                        </button>
                        <button className="cat-name" data-act="togglecat" style={{ background: 'none', textAlign: 'left' }}>{c.name}</button>
                        <span className="cat-count">{catCounts[c.id] || 0}</span>
                        <button className="cat-edit" data-act="editcat" aria-label={`Editar ${c.name}`}>
                          <svg><use href="#i-edit" /></svg>
                        </button>
                      </div>
                    ))
                  ) : (
                    <div className="empty">Nenhuma etiqueta ainda.</div>
                  )}
                </div>
              )}
            </div>
            <div>
              {keep.length ? (
                groups.map((g) => (
                  <div key={g.k} className="tgroup" data-group={g.k} {...(g.k === 'semdata' ? { 'data-drop-nodate': '1' } : {})}>
                    <div className={`tgroup-title ${g.k}`}>
                      <span>{g.label}</span>
                      <b>{g.items.length}</b>
                      <i className="rule" />
                    </div>
                    <div className="tgroup-list">
                      {g.items.length ? (
                        g.items.map((r) => <Pill key={r.t.id + (r.dk || '')} t={r.t} dk={r.dk} variant="list" cats={data.cats} />)
                      ) : (
                        <div className="empty" style={{ padding: '12px 4px', textAlign: 'left' }}>Arraste uma tarefa aqui para tirar a data.</div>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <div className="empty">
                  <b>{ctx.query ? 'Nada encontrado' : f === 'feitas' ? 'Nenhuma tarefa concluída ainda' : 'Tudo limpo por aqui'}</b>
                  {ctx.query ? 'Tente outra palavra.' : 'Crie uma tarefa ou clique em um dia do calendário.'}
                </div>
              )}
            </div>
          </div>
          <div className="side-foot">
            <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <i className={`save-dot ${saveStatus === 'saving' ? '' : saveStatus === 'error' ? 'err' : 'idle'}`} />
              <span>
                {saveStatus === 'saving' ? 'Salvando...' : saveStatus === 'error' ? 'Erro ao salvar — tentando de novo' : 'Salvo automaticamente'}
              </span>
            </span>
            <span className="footlinks">
              <button className="linkbtn" onClick={resetAll}>Apagar tudo</button>
            </span>
          </div>
        </aside>
      </div>

      <div className={`scrim ${narrow && sheetPos === 'full' ? 'on' : ''}`} onClick={() => sheetSet('peek')} />

      {/* acesso rápido flutuante — mobile: FAB no polegar; web: aba recolhida na lateral.
          O botão vem ANTES do menu no DOM para o Tab alcançar os itens abertos. */}
      <button
        className={`fab ${quickOpen ? 'open' : ''}`}
        aria-label="Acesso rápido"
        aria-expanded={quickOpen}
        onClick={() => setQuickOpen((o) => !o)}
      >
        <svg><use href="#i-plus" /></svg>
      </button>
      {quickOpen && <div className="quick-scrim" onClick={() => setQuickOpen(false)} />}
      {quickOpen && (!dockQuick ? (
        <div className="quick-menu" role="menu" aria-label="Acesso rápido">
          <button className="quick-item qi-main" role="menuitem" onClick={() => { setQuickOpen(false); novaTarefaAqui(); }}>
            Nova tarefa <i className="quick-ic"><svg><use href="#i-plus" /></svg></i>
          </button>
          <button className="quick-item qi-main" role="menuitem" onClick={() => { setQuickOpen(false); openNoteNew(); }}>
            Nova nota <i className="quick-ic"><svg><use href="#i-note" /></svg></i>
          </button>
          <button className="quick-item" role="menuitem" onClick={() => { setQuickOpen(false); setSecretsModal((s) => ({ open: true, session: s.session + 1 })); }}>
            Secrets <i className="quick-ic"><svg><use href="#i-lock" /></svg></i>
          </button>
          <button className="quick-item soon" role="menuitem" onClick={() => { setQuickOpen(false); toast.show('Infos — em breve'); }}>
            Infos <i className="quick-ic"><svg><use href="#i-info" /></svg></i>
          </button>
          <button className="quick-item" role="menuitem" onClick={() => { setQuickOpen(false); setContactsModal((s) => ({ open: true, session: s.session + 1 })); }}>
            Contatos <i className="quick-ic"><svg><use href="#i-users" /></svg></i>
          </button>
        </div>
      ) : (
        /* web: principais centrais (alinhadas à aba), demais acima e abaixo */
        <div className="quick-menu dock" role="menu" aria-label="Acesso rápido">
          <div className="q-orbit up">
            <button className="quick-item" role="menuitem" onClick={() => { setQuickOpen(false); setSecretsModal((s) => ({ open: true, session: s.session + 1 })); }}>
              Secrets <i className="quick-ic"><svg><use href="#i-lock" /></svg></i>
            </button>
            <button className="quick-item soon" role="menuitem" onClick={() => { setQuickOpen(false); toast.show('Infos — em breve'); }}>
              Infos <i className="quick-ic"><svg><use href="#i-info" /></svg></i>
            </button>
          </div>
          <div className="q-mid">
            <button className="quick-item qi-main" role="menuitem" onClick={() => { setQuickOpen(false); novaTarefaAqui(); }}>
              Nova tarefa <i className="quick-ic"><svg><use href="#i-plus" /></svg></i>
            </button>
            <button className="quick-item qi-main" role="menuitem" onClick={() => { setQuickOpen(false); openNoteNew(); }}>
              Nova nota <i className="quick-ic"><svg><use href="#i-note" /></svg></i>
            </button>
          </div>
          <div className="q-orbit down">
            <button className="quick-item" role="menuitem" onClick={() => { setQuickOpen(false); setContactsModal((s) => ({ open: true, session: s.session + 1 })); }}>
              Contatos <i className="quick-ic"><svg><use href="#i-users" /></svg></i>
            </button>
          </div>
        </div>
      ))}

      <TaskModal
        open={taskModal.open}
        session={taskModal.session}
        editing={taskModal.editing}
        pre={taskModal.pre}
        cats={data.cats}
        injectCat={injectCat}
        narrow={narrow}
        onSave={saveTask}
        onDelete={deleteTask}
        onClose={closeTask}
        onNewCat={() => openCat(null)}
        onInvalid={(m) => toast.show(m)}
      />
      <NoteModal
        open={noteModal.open}
        session={noteModal.session}
        editing={noteModal.editing}
        contacts={contacts}
        narrow={narrow}
        hoverable={hoverable}
        onSave={saveNote}
        onDelete={deleteNote}
        onClose={closeNote}
        onManageContacts={() => setContactsModal((s) => ({ open: true, session: s.session + 1 }))}
        onAskConfirm={askConfirm}
        onInvalid={(m) => toast.show(m)}
      />
      <ContactsModal
        open={contactsModal.open}
        session={contactsModal.session}
        narrow={narrow}
        contacts={contacts}
        onChange={setContacts}
        onClose={() => setContactsModal((s) => ({ ...s, open: false }))}
        onMsg={(m) => toast.show(m)}
        onConfirm={(msg, fn) =>
          askConfirm({ title: 'Excluir contato', msg, confirmLabel: 'Excluir', danger: true, onConfirm: fn })
        }
        onInvalid={(m) => toast.show(m)}
      />
      <SecretsModal
        open={secretsModal.open}
        session={secretsModal.session}
        narrow={narrow}
        onClose={() => setSecretsModal((s) => ({ ...s, open: false }))}
        onMsg={(m) => toast.show(m)}
        onInvalid={(m) => toast.show(m)}
      />
      <CatModal
        open={catModal.open}
        session={catModal.session}
        editing={catModal.editing}
        defaultColor={PALETA[data.cats.length % PALETA.length]}
        canDelete={data.cats.length > 1}
        onSave={saveCat}
        onDelete={deleteCat}
        onClose={closeCat}
        onInvalid={(m) => toast.show(m)}
      />
      <ConfigModal
        open={cfgModal.open}
        session={cfgModal.session}
        profile={profile}
        weekStart={weekStart}
        soundEnabled={data.prefs.soundEnabled}
        onWeekStart={(ws) => mutate((d) => { d.prefs.weekStart = ws; })}
        onSoundEnabled={(v) => mutate((d) => { d.prefs.soundEnabled = v; })}
        onProfile={(u) => setProfile(u)}
        onClose={() => setCfgModal((s) => ({ ...s, open: false }))}
        onMsg={(m) => toast.show(m)}
        onConfirm={(m, fn, label) =>
          askConfirm({ title: 'Confirmar', msg: m, confirmLabel: label || 'Confirmar', danger: true, onConfirm: fn })
        }
      />
      <ConfirmModal
        open={confirmModal.open}
        session={confirmModal.session}
        cfg={confirmModal.cfg}
        onClose={closeConfirm}
      />

      <div className={`toast ${toast.state.visible ? 'show' : ''}`}>
        <span>{toast.state.msg}</span>
        {toast.state.hasAction && <button onClick={toast.act}>{toast.state.label}</button>}
      </div>

      <AlertModal
        alert={alerts.current}
        queueCount={alerts.queueCount}
        cats={data.cats}
        soundEnabled={data.prefs.soundEnabled}
        onAck={alerts.ack}
        onSnooze={alerts.snooze}
        onEdit={() => {
          const a = alerts.ackForEdit();
          if (a) openTask(a.t, a.dk);
        }}
      />
    </>
  );
}
