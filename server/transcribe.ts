import express from 'express';
import { requireAuth } from './auth.js';

/* Transcrição de áudio via Groq Cloud (Whisper) — modelo turbo custa US$ 0,04/h.
   Docs: https://console.groq.com/docs/speech-to-text
   O cliente envia o áudio cru no corpo; o servidor repassa como multipart. */

const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const MODEL = process.env.GROQ_STT_MODEL || 'whisper-large-v3-turbo';

const EXT: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'mp4',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/flac': 'flac',
  'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a',
};

export const transcribeRouter = express.Router();

transcribeRouter.post(
  '/',
  requireAuth,
  express.raw({ type: () => true, limit: '20mb' }),
  async (req, res, next) => {
    try {
      const key = process.env.GROQ_API_KEY;
      if (!key)
        return res
          .status(503)
          .json({ error: 'Transcrição não configurada: defina GROQ_API_KEY no servidor.' });
      const body = req.body as Buffer;
      if (!Buffer.isBuffer(body) || !body.length) return res.status(400).json({ error: 'Áudio vazio' });

      const mime = String(req.headers['content-type'] || 'audio/webm').split(';')[0].trim();
      const ext = EXT[mime] || 'webm';
      const fd = new FormData();
      fd.append('file', new Blob([new Uint8Array(body)], { type: mime }), `gravacao.${ext}`);
      fd.append('model', MODEL);
      fd.append('language', 'pt');
      fd.append('temperature', '0');
      fd.append('response_format', 'json');

      const r = await fetch(GROQ_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}` },
        body: fd,
      });
      if (!r.ok) {
        const detail = await r.text().catch(() => '');
        console.error('Transcrição Groq falhou:', r.status, detail.slice(0, 500));
        return res.status(502).json({ error: 'A transcrição falhou. Tente de novo.' });
      }
      const out: any = await r.json();
      res.json({ text: String(out?.text ?? '').trim() });
    } catch (e) {
      next(e);
    }
  },
);
