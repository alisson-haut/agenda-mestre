/* Notas — CRUD próprio (fora do full-state sync). A nota fica registrada
   no dia de criação (date, YMD do fuso do cliente). Vínculos FROUXOS:
   task_id e contact_ids não têm FK (tasks são recriadas pelo full-state;
   contato excluído não trava a nota) — dangling é filtrado no cliente.
   Mídia: rows em note_files (upload em files/routes.ts, ANTES do save da
   nota — id gerado no cliente); a exclusão apaga objetos FORA de tx. */

import express from 'express';
import { getDB } from './db.js';
import { requireAuth, type AuthedRequest } from './auth.js';
import { getStorage, storageConfigured } from './files/storage.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const MAX_NOTES = 10_000;

const asJson = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v);
const str = (v: unknown, max: number) => String(v ?? '').slice(0, max);

function cleanNote(b: any) {
  const date = str(b?.date, 10);
  if (!DATE_RE.test(date)) throw new Error('Data da nota inválida.');
  const links = (Array.isArray(b?.links) ? b.links : [])
    .slice(0, 20)
    .map((l: any) => ({
      id: str(l?.id, 40) || 'l',
      url: str(l?.url, 2000).trim(),
      label: str(l?.label, 200).trim(),
    }))
    .filter((l: any) => /^https?:\/\//i.test(l.url));
  const contactIds = (Array.isArray(b?.contactIds) ? b.contactIds : [])
    .filter((x: any) => typeof x === 'string' && ID_RE.test(x))
    .slice(0, 20);
  const taskId = typeof b?.taskId === 'string' && ID_RE.test(b.taskId) ? b.taskId : null;
  return { title: str(b?.title, 200).trim(), desc: str(b?.desc, 20_000), date, links, contactIds, taskId };
}

const pubFile = (r: any) => ({
  id: r.id,
  noteId: r.note_id,
  kind: r.kind,
  mime: r.mime,
  size: Number(r.size) || 0,
  name: r.name,
  url: '/api/files/' + r.id,
});

const pubNote = (r: any, files: any[]) => ({
  id: r.id,
  title: r.title,
  desc: r.descr,
  date: r.date,
  links: asJson(r.links) || [],
  contactIds: asJson(r.contact_ids) || [],
  taskId: r.task_id || null,
  created: Number(r.created) || 0,
  updated: Number(r.updated) || 0,
  files: files.map(pubFile),
});

export const notesRouter = express.Router();
notesRouter.use(requireAuth);

notesRouter.get('/', async (req: AuthedRequest, res, next) => {
  try {
    const db = await getDB();
    const uid = req.user!.id;
    const notas = (await db.query('SELECT * FROM notes WHERE user_id = $1 ORDER BY created DESC', [uid])).rows;
    const files = (await db.query('SELECT * FROM note_files WHERE user_id = $1 ORDER BY created', [uid])).rows;
    const porNota = new Map<string, any[]>();
    for (const f of files) {
      if (!porNota.has(f.note_id)) porNota.set(f.note_id, []);
      porNota.get(f.note_id)!.push(f);
    }
    res.json({ notes: notas.map((n) => pubNote(n, porNota.get(n.id) || [])) });
  } catch (e) {
    next(e);
  }
});

notesRouter.post('/', async (req: AuthedRequest, res, next) => {
  try {
    const id = str(req.body?.id, 40);
    if (!ID_RE.test(id)) return res.status(400).json({ error: 'Dados inválidos' });
    let n;
    try {
      n = cleanNote(req.body);
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }
    const db = await getDB();
    const uid = req.user!.id;
    const { rows: cnt } = await db.query('SELECT COUNT(*)::int AS n FROM notes WHERE user_id = $1', [uid]);
    if ((Number(cnt[0]?.n) || 0) >= MAX_NOTES)
      return res.status(413).json({ error: 'Limite de notas atingido.' });
    const now = Date.now();
    const { rows } = await db.query(
      `INSERT INTO notes (user_id, id, title, descr, date, links, contact_ids, task_id, created, updated)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) ON CONFLICT (user_id, id) DO NOTHING RETURNING id`,
      [uid, id, n.title, n.desc, n.date, JSON.stringify(n.links), JSON.stringify(n.contactIds), n.taskId, now],
    );
    if (!rows.length) return res.status(409).json({ error: 'Nota já existe.' });
    const fl = (await db.query('SELECT * FROM note_files WHERE user_id = $1 AND note_id = $2 ORDER BY created', [uid, id])).rows;
    res.json({
      note: pubNote(
        { id, title: n.title, descr: n.desc, date: n.date, links: n.links, contact_ids: n.contactIds, task_id: n.taskId, created: now, updated: now },
        fl,
      ),
    });
  } catch (e) {
    next(e);
  }
});

notesRouter.put('/:id', async (req: AuthedRequest, res, next) => {
  try {
    let n;
    try {
      n = cleanNote(req.body);
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }
    const db = await getDB();
    const uid = req.user!.id;
    const id = str(req.params.id, 40);
    const now = Date.now();
    const { rows } = await db.query(
      `UPDATE notes SET title=$3, descr=$4, date=$5, links=$6, contact_ids=$7, task_id=$8, updated=$9
       WHERE user_id=$1 AND id=$2 RETURNING created`,
      [uid, id, n.title, n.desc, n.date, JSON.stringify(n.links), JSON.stringify(n.contactIds), n.taskId, now],
    );
    if (!rows.length) return res.status(404).json({ error: 'Nota não encontrada.' });
    const fl = (await db.query('SELECT * FROM note_files WHERE user_id = $1 AND note_id = $2 ORDER BY created', [uid, id])).rows;
    res.json({
      note: pubNote(
        { id, title: n.title, descr: n.desc, date: n.date, links: n.links, contact_ids: n.contactIds, task_id: n.taskId, created: Number(rows[0].created) || 0, updated: now },
        fl,
      ),
    });
  } catch (e) {
    next(e);
  }
});

notesRouter.delete('/:id', async (req: AuthedRequest, res, next) => {
  try {
    const db = await getDB();
    const uid = req.user!.id;
    const id = str(req.params.id, 40);
    /* ordem: coletar chaves → apagar rows → objetos por último, FORA de tx
       (DB é a fonte de verdade; objeto órfão é só lixo, row órfã seria bug) */
    const files = (
      await db.query('SELECT id, ext FROM note_files WHERE user_id = $1 AND note_id = $2', [uid, id])
    ).rows;
    const { rows } = await db.query('DELETE FROM notes WHERE user_id = $1 AND id = $2 RETURNING id', [uid, id]);
    if (!rows.length) return res.status(404).json({ error: 'Nota não encontrada.' });
    await db.query('DELETE FROM note_files WHERE user_id = $1 AND note_id = $2', [uid, id]);
    if (files.length && storageConfigured()) {
      const storage = await getStorage();
      await storage
        .deleteMany(files.map((f) => `${uid}/${id}/${f.id}.${f.ext}`))
        .catch((e) => console.error('notes: objetos não removidos:', e?.message || e));
    }
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/* ---------- varredura de órfãos ----------
   Uploads acontecem antes do save; se a nota nunca for salva, sobram rows
   em note_files (e objetos). Remove o que tem mais de 24h sem nota. */
export function startOrphanSweep() {
  const DAY = 24 * 3600 * 1000;
  const sweep = async () => {
    try {
      const db = await getDB();
      const cutoff = Date.now() - DAY;
      const { rows } = await db.query(
        `SELECT f.user_id, f.note_id, f.id, f.ext FROM note_files f
         LEFT JOIN notes n ON n.user_id = f.user_id AND n.id = f.note_id
         WHERE n.id IS NULL AND f.created < $1 LIMIT 500`,
        [cutoff],
      );
      if (!rows.length) return;
      await db.query(
        `DELETE FROM note_files f WHERE (f.user_id, f.id) IN
         (SELECT f2.user_id, f2.id FROM note_files f2
          LEFT JOIN notes n ON n.user_id = f2.user_id AND n.id = f2.note_id
          WHERE n.id IS NULL AND f2.created < $1 LIMIT 500)`,
        [cutoff],
      );
      if (storageConfigured()) {
        const storage = await getStorage();
        await storage
          .deleteMany(rows.map((r) => `${r.user_id}/${r.note_id}/${r.id}.${r.ext}`))
          .catch(() => {});
      }
      console.log(`notes: varredura removeu ${rows.length} arquivo(s) órfão(s)`);
    } catch (e: any) {
      console.error('notes: varredura de órfãos falhou:', e?.message || e);
    }
  };
  setTimeout(sweep, 30_000); /* após o boot, sem competir com a subida */
  setInterval(sweep, DAY);
}
