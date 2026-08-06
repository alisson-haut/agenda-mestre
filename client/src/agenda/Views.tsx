import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { taskCats, type Cat, type Inst, type Task } from './types';
import { addDays, dayDiff, DIA1, DIA3, hhmmOf, isWeekend, MES3, MESES, minutesOf, pad, parseYMD, today, ymd } from './dates';
import { byDay, catOf, dateLabelShort, isDone, layoutOverlaps, weekStartOf, wdayOrder, type Ctx, type EvBox } from './logic';

export const HOUR = 56; // deve casar com --hour no CSS

/* Ícone de etiqueta — imagem personalizada ou bloco de cor */
export function CatIcon({ cat, className }: { cat: Cat; className?: string }) {
  return (
    <span className={`catic ${className || ''}`} style={{ '--c': cat.color } as CSSProperties} title={cat.name}>
      {cat.icon ? <img src={cat.icon} alt="" draggable={false} /> : null}
    </span>
  );
}

/* ============================================================
   PÍLULA — o bloco visual que representa uma tarefa
   ============================================================ */
export function Pill({ t, dk, variant, cats }: { t: Task; dk: string | null; variant: 'list' | 'mini' | 'allday'; cats: Cat[] }) {
  const c = catOf(cats, t.cat);
  const pcats = taskCats(t).slice(0, 4);
  const done = isDone(t, dk);
  const cls = ['pill'];
  if (variant === 'mini') cls.push('sm');
  if (done) cls.push('done');
  if (t.prio === 'alta' && !done) cls.push('prio-alta');
  const badges: ReactNode[] = [];
  if (variant !== 'mini') {
    if (t.rec.type !== 'none')
      badges.push(<svg key="r"><use href="#i-repeat" /></svg>);
    if (t.subs.length)
      badges.push(<span key="s" className="sub">{t.subs.filter((s) => s.done).length}/{t.subs.length}</span>);
  }
  const tip = t.title + (t.time ? ' · ' + t.time : '') + (dk ? ' · ' + dateLabelShort(dk) : '');
  const shownCats = pcats.map((id) => catOf(cats, id));
  const iconsEl = (
    <span className="catics">
      {shownCats.map((cc, i) => (
        <CatIcon key={cc.id + i} cat={cc} />
      ))}
    </span>
  );

  /* variante de lista (lateral): item de duas linhas — hora+título / meta */
  if (variant === 'list') {
    cls.push('lst');
    const diff = dk ? dayDiff(parseYMD(dk), today()) : null;
    const feitas = t.subs.filter((s) => s.done).length;
    return (
      <div className={cls.join(' ')} style={{ '--c': c.color } as CSSProperties} data-id={t.id} data-dk={dk || ''} data-drag="1" title={tip}>
        <button className="pill-check" data-act="toggle" aria-label="Marcar como concluída">
          <svg><use href="#i-check" /></svg>
        </button>
        {iconsEl}
        <span className="pill-main">
          <span className="pill-l1">
            {t.time && <span className="pill-time">{t.time}</span>}
            <span className="pill-title">{t.title}</span>
          </span>
          <span className="pill-l2">
            {dk === null ? (
              <span>sem data</span>
            ) : diff !== null && diff < 0 ? (
              <span className="late">{-diff}d atrasada</span>
            ) : (
              <span>{dateLabelShort(dk)}</span>
            )}
            {t.subs.length > 0 && <span>{feitas}/{t.subs.length}</span>}
            {t.rec.type !== 'none' && <svg><use href="#i-repeat" /></svg>}
          </span>
        </span>
      </div>
    );
  }

  return (
    <div className={cls.join(' ')} style={{ '--c': c.color } as CSSProperties} data-id={t.id} data-dk={dk || ''} data-drag="1" title={tip}>
      {variant !== 'mini' && (
        <button className="pill-check" data-act="toggle" aria-label="Marcar como concluída">
          <svg><use href="#i-check" /></svg>
        </button>
      )}
      {iconsEl}
      {t.time && <span className="pill-time">{t.time}</span>}
      <span className="pill-title">{t.title}</span>
      {badges.length > 0 && <span className="pill-badges">{badges}</span>}
    </div>
  );
}

/* ============================================================
   MÊS
   ============================================================ */
export function MonthView({ ctx, anchor, selDay, weekStart, narrow }: { ctx: Ctx; anchor: Date; selDay: string | null; weekStart: number; narrow: boolean }) {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const gStart = weekStartOf(first, weekStart);
  const map = byDay(ctx, gStart, addDays(gStart, 41));
  const tk = ymd(today());
  const [maxPills, setMaxPills] = useState(99);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (narrow) {
      setMaxPills(99);
      return;
    }
    const measure = () => {
      const box = gridRef.current?.querySelector('.cell-pills') as HTMLElement | null;
      if (box && box.clientHeight > 0) setMaxPills(Math.max(1, Math.floor(box.clientHeight / 21)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (gridRef.current) ro.observe(gridRef.current);
    return () => ro.disconnect();
  }, [narrow]);

  const rows = [];
  for (let r = 0; r < 6; r++) {
    const cells = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(gStart, r * 7 + i);
      const k = ymd(d);
      const out = d.getMonth() !== anchor.getMonth();
      const items = map[k] || [];
      const over = !narrow && items.length > maxPills;
      const shown = over ? items.slice(0, Math.max(1, maxPills - 1)) : items;
      cells.push(
        <div
          key={k}
          className={`cell ${out ? 'out' : ''} ${isWeekend(d) ? 'fds' : ''} ${k === tk ? 'today' : ''} ${k === selDay ? 'sel' : ''}`}
          data-day={k}
          data-drop-day={k}
        >
          <span className="cell-num">
            {d.getDate()}
            {d.getDate() === 1 && <span className="mname">{MES3[d.getMonth()]}</span>}
          </span>
          <button className="cell-add" data-act="add" data-day={k} aria-label={`Nova tarefa em ${d.getDate()}/${d.getMonth() + 1}`}>
            <svg><use href="#i-plus" /></svg>
          </button>
          <div className="cell-pills">
            {shown.map((x) => (
              <Pill key={x.t.id + x.dk} t={x.t} dk={x.dk} variant="mini" cats={ctx.cats} />
            ))}
            {over && (
              <button className="more" data-openday={k}>+{items.length - shown.length} mais</button>
            )}
          </div>
        </div>,
      );
    }
    rows.push(<div key={r} className="mrow">{cells}</div>);
  }
  return (
    <div className="month">
      <div className="wdays">
        {wdayOrder(weekStart).map((i) => (
          <div key={i} className={`wday ${i === 0 || i === 6 ? 'fds' : ''}`}>{DIA3[i]}</div>
        ))}
      </div>
      <div className="mgrid" ref={gridRef}>{rows}</div>
    </div>
  );
}

/* ============================================================
   MINI-MÊS (trimestre e ano)
   ============================================================ */
export function MiniMonth({ mDate, ctx, weekStart, selDay, heat = false, fixed6 = false }: { mDate: Date; ctx: Ctx; weekStart: number; selDay: string | null; heat?: boolean; fixed6?: boolean }) {
  const first = new Date(mDate.getFullYear(), mDate.getMonth(), 1);
  const gStart = weekStartOf(first, weekStart);
  const weeks = fixed6
    ? 6
    : Math.ceil((((first.getDay() - weekStart + 7) % 7) + new Date(mDate.getFullYear(), mDate.getMonth() + 1, 0).getDate()) / 7);
  const map = byDay(ctx, gStart, addDays(gStart, weeks * 7 - 1));
  const tk = ymd(today());
  const tnow = today();
  let total = 0;
  const cells = [];
  for (let i = 0; i < weeks * 7; i++) {
    const d = addDays(gStart, i);
    const k = ymd(d);
    const out = d.getMonth() !== mDate.getMonth();
    const items = out ? [] : map[k] || [];
    if (!out) total += items.length;
    if (heat) {
      const lvl = Math.min(4, items.length);
      cells.push(
        <button
          key={k}
          className={`mini-day ${out ? 'out' : 'heat' + lvl} ${k === tk ? 'today' : ''} ${k === selDay ? 'sel' : ''}`}
          data-day={k}
          data-drop-day={k}
          title={`${items.length} tarefa(s) em ${d.getDate()}/${d.getMonth() + 1}`}
        >
          <span>{d.getDate()}</span>
        </button>,
      );
      continue;
    }
    const seen: string[] = [];
    const dots: ReactNode[] = [];
    for (const x of items) {
      const c = catOf(ctx.cats, x.t.cat);
      if (!seen.includes(c.color)) {
        seen.push(c.color);
        if (dots.length < 3) dots.push(<i key={c.color} className="dot" style={{ '--c': c.color } as CSSProperties} />);
      }
    }
    if (items.length > 3 && dots.length === 3) dots.push(<i key="+" className="dot plus">+</i>);
    cells.push(
      <button
        key={k}
        className={`mini-day ${out ? 'out' : ''} ${k === tk ? 'today' : ''} ${k === selDay ? 'sel' : ''}`}
        data-day={k}
        data-drop-day={k}
        title={`${items.length ? items.length + ' tarefa(s)' : 'Sem tarefas'} — clique para abrir o dia`}
      >
        <span>{d.getDate()}</span>
        <span className="dots">{dots}</span>
      </button>,
    );
  }
  const isNow = mDate.getFullYear() === tnow.getFullYear() && mDate.getMonth() === tnow.getMonth();
  return (
    <section className={`mini ${heat ? 'ymini' : ''}`}>
      <header className="mini-head">
        <button className={`mini-title ${isNow ? 'is-now' : ''}`} data-openmonth={ymd(first)}>
          {MESES[mDate.getMonth()]}
        </button>
        <span className="mini-meta">{total ? total + (total === 1 ? ' tarefa' : ' tarefas') : '—'}</span>
      </header>
      <div className="mini-wdays">
        {wdayOrder(weekStart).map((i, idx) => (
          <span key={idx}>{DIA1[i]}</span>
        ))}
      </div>
      <div className="mini-grid">{cells}</div>
    </section>
  );
}

/* ============================================================
   GRADE DE HORAS (dia e semana)
   ============================================================ */
function DayStrip({ day, ctx, weekStart }: { day: Date; ctx: Ctx; weekStart: number }) {
  const s = weekStartOf(day, weekStart);
  const tk = ymd(today());
  const sel = ymd(day);
  const map = byDay(ctx, s, addDays(s, 6));
  return (
    <div className="strip">
      {Array.from({ length: 7 }, (_, i) => {
        const x = addDays(s, i);
        const k = ymd(x);
        const items = map[k] || [];
        const cores: string[] = [];
        for (const it of items) {
          const c = catOf(ctx.cats, it.t.cat);
          if (!cores.includes(c.color) && cores.length < 3) cores.push(c.color);
        }
        return (
          <button key={k} className={`strip-day ${k === sel ? 'on' : ''} ${k === tk ? 'now' : ''}`} data-openday={k} data-drop-day={k}>
            <span className="sd-w">{DIA3[x.getDay()]}</span>
            <span className="sd-n">{x.getDate()}</span>
            <span className="dots">
              {cores.map((c) => (
                <i key={c} className="dot" style={{ '--c': c } as CSSProperties} />
              ))}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function TimeGrid({ days, ctx, weekStart, narrow }: { days: Date[]; ctx: Ctx; weekStart: number; narrow: boolean }) {
  const map = byDay(ctx, days[0], days[days.length - 1]);
  const tk = ymd(today());
  const colw = narrow && days.length > 1 ? 106 : 0;
  const cols = colw ? `52px repeat(${days.length},${colw}px)` : `52px repeat(${days.length},minmax(0,1fr))`;
  const gridStyle = colw ? { width: 52 + days.length * colw } : undefined;

  const [nowMin, setNowMin] = useState(() => {
    const n = new Date();
    return n.getHours() * 60 + n.getMinutes();
  });
  useEffect(() => {
    const iv = window.setInterval(() => {
      const n = new Date();
      setNowMin(n.getHours() * 60 + n.getMinutes());
    }, 30000);
    return () => window.clearInterval(iv);
  }, []);

  const gutter = [];
  for (let h = 0; h < 24; h++)
    gutter.push(
      <div key={h} className="tg-hourlabel">{h ? <span>{pad(h)}:00</span> : null}</div>,
    );

  return (
    <>
      {days.length === 1 && <DayStrip day={days[0]} ctx={ctx} weekStart={weekStart} />}
      <div className={`tgwrap${days.length === 1 ? ' solo' : ''}`} id="tgWrap">
        <div className="tgrid" style={gridStyle}>
          <div className="tg-head" style={{ gridTemplateColumns: cols }}>
            <div className="tg-corner" />
            {days.map((d) => {
              const k = ymd(d);
              return (
                <button key={k} className={`tg-dayhead ${k === tk ? 'today' : ''}`} data-openday={k}>
                  <span className="dw">{DIA3[d.getDay()]}</span>
                  <span className="dn">
                    {d.getDate()}
                    {k === tk && <span className="dh-hoje">hoje</span>}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="tg-allday" style={{ gridTemplateColumns: cols }}>
            <div className="tg-alllabel">sem hora</div>
            {days.map((d) => {
              const k = ymd(d);
              const items = (map[k] || []).filter((x) => !x.t.time);
              return (
                <div key={k} className="tg-allcol" data-drop-day={k}>
                  {items.map((x) => (
                    <Pill key={x.t.id + x.dk} t={x.t} dk={x.dk} variant="allday" cats={ctx.cats} />
                  ))}
                </div>
              );
            })}
          </div>
          <div className="tg-body" id="tgBody" style={{ gridTemplateColumns: cols }}>
            <div className="tg-gutter">{gutter}</div>
            {days.map((d) => {
              const k = ymd(d);
              const slots = [];
              for (let i = 0; i < 48; i++)
                slots.push(
                  <div key={i} className={`slot half ${i % 2 === 1 ? 'hb' : ''}`} data-slot={k} data-min={i * 30} />,
                );
              const evs: EvBox[] = (map[k] || [])
                .filter((x) => x.t.time)
                .map((x: Inst) => ({
                  x,
                  s: minutesOf(x.t.time!),
                  e: minutesOf(x.t.time!) + Math.max(20, x.t.dur),
                  col: 0,
                  cols: 1,
                }));
              layoutOverlaps(evs);
              const items = evs.map((o) => {
                const t = o.x.t;
                const c = catOf(ctx.cats, t.cat);
                const evCats = taskCats(t).slice(0, 4).map((id) => catOf(ctx.cats, id));
                const done = isDone(t, o.x.dk);
                const top = (o.s / 60) * HOUR;
                const h = Math.max(22, (Math.max(20, t.dur) / 60) * HOUR);
                const w = 100 / o.cols;
                const left = o.col * w;
                const short = h < 40;
                return (
                  <div
                    key={t.id + o.x.dk}
                    className={`event ${done ? 'done' : ''} ${short ? 'short' : ''}`}
                    style={{
                      '--c': c.color,
                      top,
                      height: h - 2,
                      left: `calc(${left}% + 3px)`,
                      width: `calc(${w}% - 6px)`,
                      paddingRight: evCats.length ? 8 + 10 * evCats.length : undefined,
                    } as CSSProperties}
                    data-id={t.id}
                    data-dk={o.x.dk}
                    data-drag="1"
                    title={`${t.title} · ${t.time}`}
                  >
                    {evCats.length > 0 && (
                      <span className="ev-catics">
                        {evCats.map((cc, i) => (
                          <CatIcon key={cc.id + i} cat={cc} />
                        ))}
                      </span>
                    )}
                    <span className="ev-time">{t.time}</span>
                    <span className="ev-title">{t.title}</span>
                  </div>
                );
              });
              const now =
                k === tk ? (
                  <div className="nowline" style={{ top: (nowMin / 60) * HOUR }}>
                    {days.length === 1 && <span className="nowtag">{hhmmOf(nowMin)}</span>}
                    <b />
                    <i />
                  </div>
                ) : null;
              return (
                <div key={k} className={`tg-col ${isWeekend(d) ? 'fds' : ''} ${k === tk ? 'today' : ''}`}>
                  {slots}
                  {items}
                  {now}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
