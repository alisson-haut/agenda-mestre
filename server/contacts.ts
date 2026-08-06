/* Contatos — CRUD próprio (fora do full-state sync) + modelo/import CSV.
   Validação manual no padrão do state.ts; erros em PT-BR. */

import crypto from 'node:crypto';
import express from 'express';
import { getDB, type Q } from './db.js';
import { requireAuth, limited, EMAIL_RE, type AuthedRequest } from './auth.js';

const MAX_CONTACTS = 5000;
const AVATAR_RE = /^data:image\/(png|jpe?g|webp|gif);base64,/;

const str = (v: unknown, max: number) => String(v ?? '').slice(0, max);

function cleanContact(b: any) {
  const name = str(b?.name, 120).trim();
  if (!name) throw new Error('Informe o nome do contato.');
  const email = str(b?.email, 200).trim().toLowerCase();
  if (email && !EMAIL_RE.test(email)) throw new Error('E-mail do contato inválido.');
  return {
    name,
    phone: str(b?.phone, 40).replace(/[^\d+() -]/g, ''),
    email,
    company: str(b?.company, 120).trim(),
    notes: str(b?.notes, 2000),
    avatar:
      typeof b?.avatar === 'string' && AVATAR_RE.test(b.avatar) && b.avatar.length <= 160_000
        ? b.avatar
        : null,
  };
}

const pub = (r: any) => ({
  id: r.id,
  name: r.name,
  phone: r.phone,
  email: r.email,
  company: r.company,
  notes: r.notes,
  avatar: r.avatar || null,
  created: Number(r.created) || 0,
});

async function countOf(q: Q, uid: string): Promise<number> {
  const { rows } = await q.query('SELECT COUNT(*)::int AS n FROM contacts WHERE user_id = $1', [uid]);
  return Number(rows[0]?.n) || 0;
}

export const contactsRouter = express.Router();
contactsRouter.use(requireAuth);

contactsRouter.get('/', async (req: AuthedRequest, res, next) => {
  try {
    const db = await getDB();
    const { rows } = await db.query('SELECT * FROM contacts WHERE user_id = $1 ORDER BY name', [
      req.user!.id,
    ]);
    res.json({ contacts: rows.map(pub) });
  } catch (e) {
    next(e);
  }
});

/* modelo para preenchimento no Excel/Sheets — BOM UTF-8 e ";" (Excel PT-BR).
   Registrado ANTES de /:id para a rota dinâmica não capturar o caminho. */
contactsRouter.get('/modelo-csv', (_req, res) => {
  const csv =
    '﻿nome;telefone;email;empresa;observacoes\r\n' +
    'Ana Souza;+55 (11) 91234-5678;ana@exemplo.com.br;Empresa Exemplo;Cliente desde 2024\r\n';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="contatos-modelo.csv"');
  res.send(csv);
});

contactsRouter.post('/', async (req: AuthedRequest, res, next) => {
  try {
    const id = str(req.body?.id, 40);
    if (!id) return res.status(400).json({ error: 'Dados inválidos' });
    let c;
    try {
      c = cleanContact(req.body);
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }
    const db = await getDB();
    const uid = req.user!.id;
    if ((await countOf(db, uid)) >= MAX_CONTACTS)
      return res.status(413).json({ error: 'Limite de contatos atingido.' });
    const created = Date.now();
    const { rows } = await db.query(
      `INSERT INTO contacts (user_id, id, name, phone, email, company, notes, avatar, created)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (user_id, id) DO NOTHING RETURNING id`,
      [uid, id, c.name, c.phone, c.email, c.company, c.notes, c.avatar, created],
    );
    if (!rows.length) return res.status(409).json({ error: 'Contato já existe.' });
    res.json({ contact: { id, ...c, created } });
  } catch (e) {
    next(e);
  }
});

contactsRouter.put('/:id', async (req: AuthedRequest, res, next) => {
  try {
    let c;
    try {
      c = cleanContact(req.body);
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }
    const db = await getDB();
    const { rows } = await db.query(
      `UPDATE contacts SET name=$3, phone=$4, email=$5, company=$6, notes=$7, avatar=$8
       WHERE user_id=$1 AND id=$2 RETURNING created`,
      [req.user!.id, str(req.params.id, 40), c.name, c.phone, c.email, c.company, c.notes, c.avatar],
    );
    if (!rows.length) return res.status(404).json({ error: 'Contato não encontrado.' });
    res.json({ contact: { id: req.params.id, ...c, created: Number(rows[0].created) || 0 } });
  } catch (e) {
    next(e);
  }
});

contactsRouter.delete('/:id', async (req: AuthedRequest, res, next) => {
  try {
    const db = await getDB();
    const { rows } = await db.query(
      'DELETE FROM contacts WHERE user_id=$1 AND id=$2 RETURNING id',
      [req.user!.id, str(req.params.id, 40)],
    );
    if (!rows.length) return res.status(404).json({ error: 'Contato não encontrado.' });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/* ---------- import CSV ---------- */

/* Parser CSV artesanal (RFC 4180): aspas com escape "" e quebras de linha
   dentro de campo. Delimitador autodetectado (";" do Excel PT-BR ou ","). */
function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.slice(0, src.indexOf('\n') < 0 ? src.length : src.indexOf('\n'));
  const delim = (firstLine.match(/;/g)?.length || 0) >= (firstLine.match(/,/g)?.length || 0) ? ';' : ',';
  const rows: string[][] = [];
  let field = '', row: string[] = [], inQ = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQ) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === delim) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim())) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim())) rows.push(row);
  return rows;
}

const norm = (s: string) =>
  s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const HEADERS: Record<string, string[]> = {
  name: ['nome', 'name', 'contato'],
  phone: ['telefone', 'phone', 'celular', 'whatsapp', 'fone'],
  email: ['email', 'e-mail', 'mail'],
  company: ['empresa', 'company', 'organizacao'],
  notes: ['observacoes', 'observacao', 'notas', 'notes', 'obs'],
};

contactsRouter.post(
  '/import',
  express.text({ type: () => true, limit: '1mb' }),
  async (req: AuthedRequest, res, next) => {
    try {
      const uid = req.user!.id;
      if (limited('csvimp:' + uid, 10))
        return res.status(429).json({ error: 'Muitas importações. Aguarde alguns minutos.' });
      const text = typeof req.body === 'string' ? req.body : '';
      if (!text.trim()) return res.status(400).json({ error: 'Arquivo CSV vazio.' });
      const rows = parseCsv(text);
      if (rows.length < 2)
        return res.status(400).json({ error: 'CSV sem dados — baixe o modelo e preencha.' });
      if (rows.length > 2001)
        return res.status(413).json({ error: 'CSV grande demais (máximo 2000 contatos por vez).' });

      /* mapeia colunas pelo cabeçalho (flexível a nomes/acentos) */
      const head = rows[0].map(norm);
      const col: Record<string, number> = {};
      for (const [key, aliases] of Object.entries(HEADERS)) {
        const i = head.findIndex((h) => aliases.includes(h));
        if (i >= 0) col[key] = i;
      }
      if (col.name === undefined)
        return res.status(400).json({ error: 'CSV sem coluna "nome" — baixe o modelo.' });

      const db = await getDB();
      const existentes = await countOf(db, uid);
      const emailsExistentes = new Set(
        (await db.query('SELECT email FROM contacts WHERE user_id = $1 AND email <> $2', [uid, ''])).rows.map(
          (r) => r.email,
        ),
      );

      const prontos: any[] = [];
      const errors: { line: number; motivo: string }[] = [];
      let skipped = 0;
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        const pick = (k: string) => (col[k] !== undefined ? r[col[k]] ?? '' : '');
        try {
          const c = cleanContact({
            name: pick('name'),
            phone: pick('phone'),
            email: pick('email'),
            company: pick('company'),
            notes: pick('notes'),
          });
          if (c.email && emailsExistentes.has(c.email)) {
            skipped++;
            continue;
          }
          if (c.email) emailsExistentes.add(c.email);
          prontos.push(c);
        } catch (e: any) {
          if (errors.length < 50) errors.push({ line: i + 1, motivo: e.message });
          skipped++;
        }
      }
      if (existentes + prontos.length > MAX_CONTACTS)
        return res.status(413).json({ error: 'Limite de contatos atingido.' });

      const base = Date.now();
      /* só DB dentro da transação — sem I/O de rede (PGlite) */
      await db.tx(async (q) => {
        for (let i = 0; i < prontos.length; i++) {
          const c = prontos[i];
          await q.query(
            `INSERT INTO contacts (user_id, id, name, phone, email, company, notes, avatar, created)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [uid, crypto.randomUUID(), c.name, c.phone, c.email, c.company, c.notes, null, base + i],
          );
        }
      });
      res.json({ imported: prontos.length, skipped, errors });
    } catch (e) {
      next(e);
    }
  },
);
