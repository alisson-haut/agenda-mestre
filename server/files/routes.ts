/* Rotas de mídia das notas — proxy autenticado para o storage.
   Upload em STREAMING: o express.json global só consome application/json,
   então `req` chega aqui como stream intocado (se algum body-parser
   genérico for adicionado no index.ts, o upload quebra — não adicionar).
   userId vem SEMPRE da sessão; a chave do objeto nunca usa input livre. */

import crypto from 'node:crypto';
import express from 'express';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { getDB } from '../db.js';
import { requireAuth, limited, type AuthedRequest } from '../auth.js';
import { getStorage, storageConfigured } from './storage.js';

const MB = 1024 * 1024;
const num = (env: string | undefined, def: number) => (Number(env) > 0 ? Number(env) : def);

/* allowlist MIME→extensão por tipo — SVG/HTML proibidos (XSS) */
const KINDS: Record<string, { mimes: Record<string, string>; maxMb: number }> = {
  foto: {
    mimes: { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' },
    maxMb: num(process.env.FILES_MAX_FOTO_MB, 15),
  },
  video: {
    mimes: { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' },
    maxMb: num(process.env.FILES_MAX_VIDEO_MB, 95) /* Cloudflare proxiado corta em 100MB */,
  },
  audio: {
    mimes: {
      'audio/webm': 'weba',
      'audio/ogg': 'ogg',
      'audio/mp4': 'm4a',
      'audio/mpeg': 'mp3',
      'audio/m4a': 'm4a',
      'audio/x-m4a': 'm4a',
      'audio/wav': 'wav',
    },
    maxMb: num(process.env.FILES_MAX_AUDIO_MB, 30),
  },
  anexo: {
    mimes: {
      'application/pdf': 'pdf',
      'text/plain': 'txt',
      'text/csv': 'csv',
      'application/zip': 'zip',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    },
    maxMb: num(process.env.FILES_MAX_ANEXO_MB, 25),
  },
};
const QUOTA_BYTES = num(process.env.FILES_USER_QUOTA_MB, 500) * MB;

const key = (uid: string, noteId: string, fileId: string, ext: string) =>
  `${uid}/${noteId}/${fileId}.${ext}`;

const pub = (r: any) => ({
  id: r.id,
  noteId: r.note_id,
  kind: r.kind,
  mime: r.mime,
  size: Number(r.size) || 0,
  name: r.name,
  url: '/api/files/' + r.id,
});

export const filesRouter = express.Router();
filesRouter.use(requireAuth);
filesRouter.use((_req, res, next) => {
  if (!storageConfigured())
    return res.status(503).json({
      error:
        'Armazenamento de arquivos não configurado: defina MINIO_SERVER_URL, MINIO_ROOT_USER e MINIO_ROOT_PASSWORD (ou FILES_DIR) no servidor.',
    });
  next();
});

/* upload streaming — corpo cru; Content-Type = MIME real; Content-Length obrigatório */
filesRouter.post('/notes/:noteId', async (req: AuthedRequest, res, next) => {
  try {
    const uid = req.user!.id;
    if (limited('up:' + uid, 100)) return res.status(429).json({ error: 'Muitos envios. Aguarde alguns minutos.' });

    const noteId = String(req.params.noteId || '');
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(noteId)) return res.status(400).json({ error: 'Nota inválida.' });
    const kind = String(req.query.kind || '');
    const spec = KINDS[kind];
    if (!spec) return res.status(400).json({ error: 'Tipo de arquivo inválido.' });
    const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const ext = spec.mimes[mime];
    if (!ext) return res.status(400).json({ error: `Formato não aceito para ${kind}: ${mime || 'desconhecido'}.` });
    const size = Number(req.headers['content-length']);
    if (!Number.isFinite(size) || size <= 0)
      return res.status(411).json({ error: 'Envio sem tamanho (Content-Length).' });
    if (size > spec.maxMb * MB)
      return res.status(413).json({ error: `Arquivo grande demais (máximo ${spec.maxMb}MB para ${kind}).` });
    const name = String(req.query.name || '').slice(0, 200).replace(/[\r\n"\\]/g, '') || `arquivo.${ext}`;

    const db = await getDB();
    const used = Number(
      (await db.query('SELECT COALESCE(SUM(size),0) AS s FROM note_files WHERE user_id = $1', [uid])).rows[0]?.s,
    ) || 0;
    if (used + size > QUOTA_BYTES)
      return res.status(413).json({ error: 'Cota de armazenamento atingida. Apague arquivos antigos.' });

    const fileId = crypto.randomUUID();
    const objKey = key(uid, noteId, fileId, ext);

    /* contador: derruba o stream se vierem MAIS bytes que o declarado */
    let seen = 0;
    const counter = new Transform({
      transform(chunk, _enc, cb) {
        seen += chunk.length;
        if (seen > size) cb(new Error('excedeu'));
        else cb(null, chunk);
      },
    });

    const storage = await getStorage();
    try {
      /* pipeline conecta req→counter; o put consome o counter (streaming real).
         O catch síncrono no putP evita unhandled rejection se o pipeline cair. */
      let putErr: any = null;
      const putP = storage.put(objKey, counter, size, mime).catch((e) => {
        putErr = e;
      });
      try {
        await pipeline(req, counter);
      } catch (e) {
        counter.destroy();
        await putP;
        throw e;
      }
      await putP;
      if (putErr) throw putErr;
      if (seen !== size) throw new Error('bytes-mismatch');
    } catch (e: any) {
      await storage.delete(objKey).catch(() => {});
      if (req.destroyed || e?.message === 'excedeu' || e?.message === 'bytes-mismatch')
        return res.status(400).json({ error: 'Envio interrompido ou tamanho inconsistente.' });
      throw e;
    }

    /* statement único, sem tx — DB é a fonte de verdade sobre o objeto */
    try {
      await db.query(
        `INSERT INTO note_files (user_id, id, note_id, kind, mime, ext, name, size, created)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [uid, fileId, noteId, kind, mime, ext, name, size, Date.now()],
      );
    } catch (e) {
      await storage.delete(objKey).catch(() => {});
      throw e;
    }
    res.json(pub({ id: fileId, note_id: noteId, kind, mime, size, name }));
  } catch (e) {
    next(e);
  }
});

filesRouter.get('/usage', async (req: AuthedRequest, res, next) => {
  try {
    const db = await getDB();
    const used = Number(
      (await db.query('SELECT COALESCE(SUM(size),0) AS s FROM note_files WHERE user_id = $1', [req.user!.id]))
        .rows[0]?.s,
    ) || 0;
    res.json({ usedBytes: used, quotaBytes: QUOTA_BYTES });
  } catch (e) {
    next(e);
  }
});

/* download/stream autenticado com suporte a Range (vídeo precisa de 206) */
filesRouter.get('/:id', async (req: AuthedRequest, res, next) => {
  try {
    const uid = req.user!.id;
    const db = await getDB();
    const { rows } = await db.query('SELECT * FROM note_files WHERE user_id = $1 AND id = $2', [
      uid,
      String(req.params.id).slice(0, 40),
    ]);
    if (!rows.length) return res.status(404).json({ error: 'Arquivo não encontrado.' });
    const f = rows[0];
    const size = Number(f.size) || 0;
    const objKey = key(uid, f.note_id, f.id, f.ext);
    const storage = await getStorage();

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', f.mime);
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    const dispo = f.kind === 'anexo' ? 'attachment' : 'inline';
    res.setHeader('Content-Disposition', `${dispo}; filename="${encodeURIComponent(f.name)}"`);

    const rangeHdr = String(req.headers.range || '');
    const m = rangeHdr.match(/^bytes=(\d*)-(\d*)$/);
    let stream;
    if (m && (m[1] || m[2])) {
      let start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
      let end = m[1] ? (m[2] ? Math.min(Number(m[2]), size - 1) : size - 1) : size - 1;
      if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
        res.setHeader('Content-Range', `bytes */${size}`);
        return res.status(416).end();
      }
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
      res.setHeader('Content-Length', String(end - start + 1));
      stream = await storage.get(objKey, { start, end });
    } else {
      res.setHeader('Content-Length', String(size));
      stream = await storage.get(objKey);
    }
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  } catch (e) {
    next(e);
  }
});

filesRouter.delete('/:id', async (req: AuthedRequest, res, next) => {
  try {
    const uid = req.user!.id;
    const db = await getDB();
    const { rows } = await db.query(
      'DELETE FROM note_files WHERE user_id = $1 AND id = $2 RETURNING note_id, ext',
      [uid, String(req.params.id).slice(0, 40)],
    );
    if (!rows.length) return res.status(404).json({ error: 'Arquivo não encontrado.' });
    const storage = await getStorage();
    await storage.delete(key(uid, rows[0].note_id, String(req.params.id), rows[0].ext)).catch((e) => {
      console.error('files: objeto não removido do storage:', e?.message || e);
    });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});
