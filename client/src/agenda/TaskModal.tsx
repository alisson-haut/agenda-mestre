import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { MAX_CATS_POR_TAREFA, taskCats, type Cat, type Prio, type Rec, type RecType, type Sub, type Task } from './types';
import { uid } from './dates';
import { Dictation } from './Dictation';
import { CatIcon } from './Views';

export interface TaskPayload {
  title: string;
  notes: string;
  cat: string;
  cats: string[];
  date: string | null;
  time: string | null;
  dur: number;
  remind: number | null;
  prio: Prio;
  rec: Rec;
  subs: Sub[];
}

interface Props {
  open: boolean;
  session: number;
  editing: Task | null;
  /** pré-preenchimento de nova tarefa (ex.: "Gerar tarefa" de uma nota) */
  pre: { date?: string | null; time?: string | null; title?: string; notes?: string };
  cats: Cat[];
  injectCat: string | null;
  narrow: boolean;
  onSave(payload: TaskPayload, editing: Task | null): void;
  onDelete(): void;
  onClose(): void;
  onNewCat(): void;
  onInvalid(msg: string): void;
}

const DURS: [string, string][] = [
  ['15', '15 min'], ['30', '30 min'], ['45', '45 min'], ['60', '1 h'], ['90', '1 h 30'],
  ['120', '2 h'], ['180', '3 h'], ['240', '4 h'], ['480', '8 h'],
];
const RECS: [RecType, string][] = [
  ['none', 'Não repete'], ['daily', 'Todo dia'], ['weekly', 'Toda semana'],
  ['biweekly', 'A cada 2 semanas'], ['monthly', 'Todo mês'], ['yearly', 'Todo ano'],
];
const REMINDS: [string, string][] = [
  ['', 'Sem lembrete'], ['0', 'Na hora'], ['5', '5 min antes'], ['10', '10 min antes'],
  ['15', '15 min antes'], ['30', '30 min antes'], ['60', '1 h antes'], ['120', '2 h antes'],
  ['1440', '1 dia antes'],
];

export function TaskModal(p: Props) {
  const [title, setTitle] = useState('');
  const [selCats, setSelCats] = useState<string[]>([]);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [dur, setDur] = useState('60');
  const [remind, setRemind] = useState('');
  const [prio, setPrio] = useState<Prio>('media');
  const [rec, setRec] = useState<RecType>('none');
  const [until, setUntil] = useState('');
  const [subs, setSubs] = useState<Sub[]>([]);
  const [notes, setNotes] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);
  const subsBox = useRef<HTMLDivElement>(null);
  const focusLast = useRef(false);

  /* reinicia o formulário toda vez que o modal abre */
  useEffect(() => {
    const t = p.editing;
    if (t) {
      setTitle(t.title);
      setSelCats(taskCats(t).slice(0, MAX_CATS_POR_TAREFA));
      setDate(t.date || '');
      setTime(t.time || '');
      setDur(String(t.dur || 60));
      setRemind(t.remind == null ? '' : String(t.remind));
      setPrio(t.prio);
      setRec(t.rec.type);
      setUntil(t.rec.until || '');
      setSubs(t.subs.map((s) => ({ ...s })));
      setNotes(t.notes || '');
    } else {
      setTitle(p.pre.title || '');
      setSelCats([]); /* sem etiqueta padrão — só se o usuário escolher */
      setDate(p.pre.date || '');
      setTime(p.pre.time || '');
      setDur('60');
      setRemind('');
      setPrio('media');
      setRec('none');
      setUntil('');
      setSubs([]);
      setNotes(p.pre.notes || '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.session]);

  /* etiqueta recém-criada no modal de etiquetas entra na seleção */
  useEffect(() => {
    if (!p.injectCat) return;
    setSelCats((prev) =>
      prev.includes(p.injectCat!) || prev.length >= MAX_CATS_POR_TAREFA ? prev : [...prev, p.injectCat!],
    );
  }, [p.injectCat]);

  function toggleCat(id: string) {
    if (!selCats.includes(id) && selCats.length >= MAX_CATS_POR_TAREFA)
      p.onInvalid(`Máximo de ${MAX_CATS_POR_TAREFA} etiquetas por tarefa.`);
    setSelCats((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_CATS_POR_TAREFA) return prev;
      return [...prev, id];
    });
  }

  useEffect(() => {
    if (!p.open) return;
    if (p.editing && p.narrow) return;
    const id = window.setTimeout(() => titleRef.current?.focus(), p.editing ? 70 : 90);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.session, p.open]);

  function doSave() {
    const tt = title.trim();
    if (!tt) {
      titleRef.current?.focus();
      p.onInvalid('Escreva um nome para a tarefa.');
      return;
    }
    const d = date || null;
    p.onSave(
      {
        title: tt,
        notes: notes.trim(),
        cat: selCats[0] || '',
        cats: selCats,
        date: d,
        time: d ? time || null : null,
        dur: +dur || 60,
        remind: d && time && remind !== '' ? +remind : null,
        prio,
        rec: { type: d ? rec : 'none', until: until || null },
        subs: subs.filter((s) => s.t.trim()).map((s) => ({ id: s.id, t: s.t.trim(), done: s.done })),
      },
      p.editing,
    );
  }
  const doSaveRef = useRef(doSave);
  doSaveRef.current = doSave;

  useEffect(() => {
    if (!p.open) return;
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        doSaveRef.current();
      }
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [p.open]);

  useEffect(() => {
    if (focusLast.current) {
      focusLast.current = false;
      const inputs = subsBox.current?.querySelectorAll<HTMLInputElement>('.st-text');
      inputs?.[inputs.length - 1]?.focus();
    }
  }, [subs.length]);

  function addSub() {
    focusLast.current = true;
    setSubs((s) => [...s, { id: uid(), t: '', done: false }]);
  }

  const total = subs.length;
  const feitas = subs.filter((s) => s.done).length;
  const head = p.editing ? (p.editing.rec.type !== 'none' ? 'Tarefa que se repete' : 'Editar tarefa') : 'Nova tarefa';

  return (
    <div
      className={`overlay ${p.open ? 'open' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="tHead"
      onClick={(e) => {
        const el = e.target as HTMLElement;
        if (el === e.currentTarget || el.closest('[data-close]')) p.onClose();
      }}
    >
      <div className="dlg">
        <div className="dlg-head">
          <div className="dlg-title" id="tHead">{head}</div>
          <button className="iconbtn" data-close aria-label="Fechar"><svg><use href="#i-close" /></svg></button>
        </div>
        <div className="dlg-body">
          <div className="dict-wrap">
            <input
              className="inp" id="tTitle" ref={titleRef} placeholder="O que precisa ser feito?" autoComplete="off"
              enterKeyHint="done" value={title} onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); doSave(); } }}
            />
            <div className="dict-slot">
              <Dictation
                label="Ditar o nome da tarefa"
                maxSecs={60}
                onText={(t) => setTitle((v) => (v ? v.replace(/\s+$/, '') + ' ' : '') + t)}
                onError={p.onInvalid}
              />
            </div>
          </div>
          <div className="field">
            <span className="label">Etiquetas · opcional, até {MAX_CATS_POR_TAREFA}</span>
            <div className="catpick">
              {p.cats.map((c) => (
                <button key={c.id} className="catopt" style={{ '--c': c.color } as CSSProperties}
                  aria-pressed={selCats.includes(c.id)} onClick={() => toggleCat(c.id)}>
                  <CatIcon cat={c} />{c.name}
                </button>
              ))}
              <button className="catopt" style={{ '--c': 'var(--ink-3)' } as CSSProperties} onClick={p.onNewCat}>
                <i />Nova
              </button>
            </div>
          </div>
          <div className="grid2">
            <div className="field">
              <label className="label" htmlFor="tDate">Data</label>
              <input className="inp" id="tDate" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="field">
              <label className="label" htmlFor="tTime">Hora</label>
              <input className="inp" id="tTime" type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
          </div>
          <div className="grid2">
            <div className="field">
              <label className="label" htmlFor="tDur">Duração</label>
              <select className="sel" id="tDur" value={dur} onChange={(e) => setDur(e.target.value)}>
                {DURS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="label" htmlFor="tRemind">Lembrete</label>
              <select
                className="sel" id="tRemind" disabled={!time}
                title={!time ? 'Defina uma hora para ativar o lembrete' : undefined}
                value={time ? remind : ''} onChange={(e) => setRemind(e.target.value)}
              >
                {REMINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          </div>
          <div className="grid2">
            <div className="field">
              <span className="label">Prioridade</span>
              <div className="segmented">
                {(['baixa', 'media', 'alta'] as Prio[]).map((pr) => (
                  <button key={pr} data-p={pr} aria-pressed={prio === pr} onClick={() => setPrio(pr)}>
                    {pr === 'baixa' ? 'Baixa' : pr === 'media' ? 'Média' : 'Alta'}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label className="label" htmlFor="tRec">Repetir</label>
              <select className="sel" id="tRec" value={rec} onChange={(e) => setRec(e.target.value as RecType)}>
                {RECS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          </div>
          {rec !== 'none' && (
            <div className="field">
              <label className="label" htmlFor="tUntil">Repetir até (opcional)</label>
              <input className="inp" id="tUntil" type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
            </div>
          )}
          <div className="field">
            <span className="label">{total ? `Subtarefas · ${feitas} de ${total}` : 'Subtarefas'}</span>
            <div className="subtasks" ref={subsBox}>
              {subs.map((s, i) => (
                <div key={s.id} className={`st ${s.done ? 'done' : ''}`}>
                  <button className="st-box" aria-label="Concluir subtarefa"
                    onClick={() => setSubs((arr) => arr.map((x, j) => (j === i ? { ...x, done: !x.done } : x)))}>
                    <svg><use href="#i-check" /></svg>
                  </button>
                  <input className="st-text" value={s.t} placeholder="Descreva a subtarefa" enterKeyHint="next"
                    onChange={(e) => setSubs((arr) => arr.map((x, j) => (j === i ? { ...x, t: e.target.value } : x)))}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSub(); } }}
                  />
                  <button className="st-del" aria-label="Remover subtarefa"
                    onClick={() => setSubs((arr) => arr.filter((_, j) => j !== i))}>
                    <svg><use href="#i-close" /></svg>
                  </button>
                </div>
              ))}
            </div>
            <button className="st-add" onClick={addSub}>
              <svg style={{ width: 16, height: 16 }}><use href="#i-plus" /></svg> Adicionar subtarefa
            </button>
            {total > 0 && (
              <div className="progressbar"><i style={{ width: `${(feitas / total) * 100}%` }} /></div>
            )}
          </div>
          <div className="field">
            <label className="label" htmlFor="tNotes">Anotações</label>
            <div className="dict-wrap multi">
              <textarea className="txt" id="tNotes" placeholder="Detalhes, links, lembretes..."
                value={notes} onChange={(e) => setNotes(e.target.value)} />
              <div className="dict-slot">
                <Dictation
                  label="Ditar anotações"
                  maxSecs={360}
                  onText={(t) => setNotes((v) => (v ? v.replace(/\s+$/, '') + '\n' : '') + t)}
                  onError={p.onInvalid}
                />
              </div>
            </div>
          </div>
        </div>
        <div className="dlg-foot">
          <span className="save-hint">⌘↵ salva</span>
          {p.editing && (
            <button className="btn btn-danger btn-icon" onClick={p.onDelete} aria-label="Excluir tarefa">
              <svg><use href="#i-trash" /></svg>
            </button>
          )}
          <div className="spacer" />
          <button className="btn btn-ghost" data-close>Cancelar</button>
          <button className="btn btn-primary" onClick={doSave}>Salvar tarefa</button>
        </div>
      </div>
    </div>
  );
}
