import express from 'express';
import { getDB } from './db.js';
import { requireAuth, type AuthedRequest } from './auth.js';

/* O cliente trabalha com o estado inteiro (tarefas + etiquetas + preferências)
   e sincroniza com PUT debounced — o servidor decompõe em tabelas reais. */

const PRIOS = new Set(['baixa', 'media', 'alta']);
const RECS = new Set(['none', 'daily', 'weekly', 'biweekly', 'monthly', 'yearly']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

const asJson = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v);
const str = (v: unknown, max: number) => String(v ?? '').slice(0, max);

const ICON_RE = /^data:image\/(png|jpe?g|webp|gif);base64,/;

function cleanCat(c: any, i: number) {
  if (!c || typeof c.id !== 'string') throw new Error('etiqueta inválida');
  return {
    id: str(c.id, 40),
    name: str(c.name, 120) || 'Etiqueta',
    color: /^#[0-9a-fA-F]{3,8}$/.test(String(c.color)) ? String(c.color) : '#8B928C',
    icon:
      typeof c.icon === 'string' && ICON_RE.test(c.icon) && c.icon.length <= 120_000 ? c.icon : null,
    position: i,
  };
}

function cleanTask(t: any) {
  if (!t || typeof t.id !== 'string' || typeof t.title !== 'string') throw new Error('tarefa inválida');
  const rec = t.rec && RECS.has(t.rec.type) ? t.rec : { type: 'none', until: null };
  const cats: string[] = (Array.isArray(t.cats) ? t.cats : [])
    .filter((x: any) => typeof x === 'string' && x)
    .map((x: string) => x.slice(0, 40))
    .slice(0, 4);
  if (!cats.length && typeof t.cat === 'string' && t.cat) cats.push(t.cat.slice(0, 40));
  return {
    id: str(t.id, 40),
    title: str(t.title, 500),
    notes: str(t.notes, 10_000),
    cat: cats[0] || '',
    cats,
    date: typeof t.date === 'string' && DATE_RE.test(t.date) ? t.date : null,
    time: typeof t.time === 'string' && TIME_RE.test(t.time) ? t.time : null,
    dur: Math.min(Math.max(Number(t.dur) || 60, 5), 24 * 60),
    remind:
      t.remind === null || t.remind === undefined || t.remind === ''
        ? null
        : Math.min(Math.max(Math.round(Number(t.remind)) || 0, 0), 7 * 24 * 60),
    prio: PRIOS.has(t.prio) ? t.prio : 'media',
    rec: { type: rec.type, until: typeof rec.until === 'string' && DATE_RE.test(rec.until) ? rec.until : null },
    subs: Array.isArray(t.subs)
      ? t.subs.slice(0, 100).map((s: any) => ({ id: str(s?.id, 40), t: str(s?.t, 500), done: !!s?.done }))
      : [],
    doneDates: Array.isArray(t.doneDates) ? t.doneDates.filter((d: any) => DATE_RE.test(String(d))).slice(0, 5000) : [],
    done: !!t.done,
    created: Number(t.created) || Date.now(),
  };
}

export const stateRouter = express.Router();

stateRouter.get('/', requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const db = await getDB();
    const uid = req.user!.id;
    const cats = (
      await db.query('SELECT id, name, color, icon FROM categories WHERE user_id = $1 ORDER BY position', [uid])
    ).rows.map((r) => ({ id: r.id, name: r.name, color: r.color, icon: r.icon || null }));
    const tasks = (
      await db.query(
        'SELECT id, title, notes, cat, cats, date, time, dur, remind, prio, rec, subs, done_dates, done, created FROM tasks WHERE user_id = $1',
        [uid],
      )
    ).rows.map((r) => ({
      id: r.id,
      title: r.title,
      notes: r.notes,
      cat: r.cat,
      cats: asJson(r.cats) || [],
      date: r.date,
      time: r.time,
      dur: Number(r.dur),
      remind: r.remind === null || r.remind === undefined ? null : Number(r.remind),
      prio: r.prio,
      rec: asJson(r.rec),
      subs: asJson(r.subs),
      doneDates: asJson(r.done_dates),
      done: !!r.done,
      created: Number(r.created),
    }));
    const prow = (await db.query('SELECT data FROM prefs WHERE user_id = $1', [uid])).rows[0];
    res.json({ cats, tasks, prefs: prow ? asJson(prow.data) : null });
  } catch (e) {
    next(e);
  }
});

stateRouter.put('/', requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const uid = req.user!.id;
    const body = req.body ?? {};
    if (!Array.isArray(body.cats) || !Array.isArray(body.tasks))
      return res.status(400).json({ error: 'Formato inválido' });
    if (body.cats.length > 200 || body.tasks.length > 5000)
      return res.status(413).json({ error: 'Estado grande demais' });

    let cats, tasks;
    try {
      cats = body.cats.map(cleanCat);
      tasks = body.tasks.map(cleanTask);
    } catch {
      return res.status(400).json({ error: 'Dados inválidos' });
    }
    const prefs = body.prefs && typeof body.prefs === 'object' ? body.prefs : {};

    const db = await getDB();
    await db.tx(async (q) => {
      await q.query('DELETE FROM categories WHERE user_id = $1', [uid]);
      await q.query('DELETE FROM tasks WHERE user_id = $1', [uid]);
      for (const c of cats)
        await q.query(
          'INSERT INTO categories (user_id, id, name, color, icon, position) VALUES ($1,$2,$3,$4,$5,$6)',
          [uid, c.id, c.name, c.color, c.icon, c.position],
        );
      for (const t of tasks)
        await q.query(
          `INSERT INTO tasks (user_id, id, title, notes, cat, cats, date, time, dur, remind, prio, rec, subs, done_dates, done, created)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
          [
            uid, t.id, t.title, t.notes, t.cat, JSON.stringify(t.cats), t.date, t.time, t.dur, t.remind, t.prio,
            JSON.stringify(t.rec), JSON.stringify(t.subs), JSON.stringify(t.doneDates), t.done, t.created,
          ],
        );
      await q.query(
        `INSERT INTO prefs (user_id, data) VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data`,
        [uid, JSON.stringify(prefs)],
      );
    });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});
