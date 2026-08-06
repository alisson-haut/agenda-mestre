import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import express, { type Request, type Response, type NextFunction } from 'express';
import { getDB } from './db.js';
import { sendEmail } from './notify/resend.js';
import { appUrl } from './notify/templates.js';
import { authFrom, resetEmailHtml, resetEmailSubject } from './notify/auth-emails.js';

export const COOKIE = 'am_session';
const SESSION_DAYS = 30;
const PROD = process.env.NODE_ENV === 'production';

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

/* auditoria estruturada de eventos de auth — NUNCA logar senha/token/hash */
export const audit = (evt: string, data: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), evt, ...data }));

/* limitador simples em memória: protege login/registro de força bruta */
const attempts = new Map<string, { n: number; t: number }>();
export function limited(key: string, max = 10, windowMs = 10 * 60_000): boolean {
  const now = Date.now();
  const a = attempts.get(key);
  if (!a || now - a.t > windowMs) {
    attempts.set(key, { n: 1, t: now });
    return false;
  }
  a.n++;
  return a.n > max;
}

export function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function setSessionCookie(res: Response, token: string) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: PROD,
    maxAge: SESSION_DAYS * 24 * 3600 * 1000,
    path: '/',
  });
}

export async function createSession(userId: string, res: Response) {
  const token = crypto.randomBytes(32).toString('hex');
  const db = await getDB();
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000);
  await db.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1,$2,$3)', [
    sha256(token),
    userId,
    expires.toISOString(),
  ]);
  setSessionCookie(res, token);
}

export interface AuthedRequest extends Request {
  user?: { id: string; email: string; name: string; avatar: string | null };
}

export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  try {
    const token = readCookie(req, COOKIE);
    if (!token) return res.status(401).json({ error: 'Não autenticado' });
    const db = await getDB();
    const { rows } = await db.query(
      `SELECT u.id, u.email, u.name, u.avatar FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [sha256(token)],
    );
    if (!rows.length) return res.status(401).json({ error: 'Sessão expirada' });
    req.user = rows[0];
    next();
  } catch (e) {
    next(e);
  }
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const authRouter = express.Router();

authRouter.post('/register', async (req, res, next) => {
  try {
    const ip = req.ip || 'x';
    if (limited('reg:' + ip, PROD ? 20 : 1000))
      return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos.' });
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');
    const name = String(req.body?.name ?? '').trim().slice(0, 80);
    if (!EMAIL_RE.test(email) || email.length > 200) return res.status(400).json({ error: 'E-mail inválido' });
    if (password.length < 8 || password.length > 200)
      return res.status(400).json({ error: 'A senha precisa de pelo menos 8 caracteres' });
    const db = await getDB();
    const hash = await bcrypt.hash(password, 12);
    const id = crypto.randomUUID();
    try {
      await db.query('INSERT INTO users (id, email, name, password_hash) VALUES ($1,$2,$3,$4)', [id, email, name, hash]);
    } catch (e: any) {
      if (String(e?.code) === '23505' || /unique/i.test(String(e?.message)))
        return res.status(409).json({ error: 'Este e-mail já tem conta. Entre com sua senha.' });
      throw e;
    }
    await createSession(id, res);
    audit('auth.register_ok', { userId: id, ip: req.ip });
    res.json({ id, email, name, avatar: null });
  } catch (e) {
    next(e);
  }
});

authRouter.post('/login', async (req, res, next) => {
  try {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');
    const key = 'login:' + (req.ip || 'x') + ':' + email;
    if (limited(key)) return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos.' });
    const db = await getDB();
    const { rows } = await db.query('SELECT id, email, name, avatar, password_hash FROM users WHERE email = $1', [email]);
    const ok = rows.length && (await bcrypt.compare(password, rows[0].password_hash));
    if (!ok) {
      audit('auth.login_fail', { ip: req.ip });
      return res.status(401).json({ error: 'E-mail ou senha incorretos' });
    }
    attempts.delete(key);
    audit('auth.login_ok', { userId: rows[0].id, ip: req.ip });
    await createSession(rows[0].id, res);
    res.json({ id: rows[0].id, email: rows[0].email, name: rows[0].name, avatar: rows[0].avatar || null });
  } catch (e) {
    next(e);
  }
});

authRouter.post('/logout', async (req, res, next) => {
  try {
    const token = readCookie(req, COOKIE);
    if (token) {
      const db = await getDB();
      await db.query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
    }
    res.clearCookie(COOKIE, { path: '/' });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

authRouter.get('/me', requireAuth, (req: AuthedRequest, res) => {
  res.json(req.user);
});

authRouter.post('/password', requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const current = String(req.body?.current ?? '');
    const nova = String(req.body?.next ?? '');
    if (nova.length < 8 || nova.length > 200)
      return res.status(400).json({ error: 'A nova senha precisa de pelo menos 8 caracteres' });
    const key = 'pass:' + (req.ip || 'x') + ':' + req.user!.id;
    if (limited(key)) return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos.' });
    const db = await getDB();
    const { rows } = await db.query('SELECT password_hash FROM users WHERE id = $1', [req.user!.id]);
    if (!rows.length || !(await bcrypt.compare(current, rows[0].password_hash)))
      return res.status(401).json({ error: 'Senha atual incorreta' });
    attempts.delete(key);
    const hash = await bcrypt.hash(nova, 12);
    await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.user!.id]);
    /* derruba as outras sessões, mantendo a atual */
    const token = readCookie(req, COOKIE);
    await db.query('DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2', [
      req.user!.id,
      token ? sha256(token) : '',
    ]);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/* ---------------- recuperação de senha ---------------- */

const GENERIC_FORGOT = {
  ok: true,
  message: 'Se este e-mail tiver uma conta, enviaremos um link de recuperação.',
};

authRouter.post('/forgot', async (req, res, next) => {
  try {
    const ip = req.ip || 'x';
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    /* por IP relaxado fora de produção (e2e sai todo de 127.0.0.1);
       por e-mail ATIVO também em dev — determinístico e testável */
    if (limited('forgot:ip:' + ip, PROD ? 5 : 1000, 15 * 60_000))
      return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos.' });
    if (limited('forgot:em:' + email, 3, 15 * 60_000))
      return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos.' });
    if (!EMAIL_RE.test(email) || email.length > 200)
      return res.status(400).json({ error: 'E-mail inválido' });

    const db = await getDB();
    /* GC oportunista de tokens antigos */
    await db.query(`DELETE FROM password_resets WHERE expires_at < now() - interval '1 day'`);
    const { rows } = await db.query('SELECT id, name FROM users WHERE email = $1', [email]);
    if (!rows.length) {
      audit('auth.forgot', { ip, found: false });
      return res.json(GENERIC_FORGOT); /* resposta idêntica — sem enumeração */
    }
    const uid = rows[0].id;
    /* o link mais novo é o único válido */
    await db.query('UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [uid]);
    const token = crypto.randomBytes(32).toString('hex');
    await db.query(
      `INSERT INTO password_resets (id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, now() + interval '30 minutes')`,
      [crypto.randomUUID(), uid, sha256(token)],
    );
    const link = `${appUrl()}/reset?token=${token}`;

    /* fire-and-forget: a resposta genérica não espera nem revela o resultado
       do Resend (sem side-channel de tempo/erro) */
    void sendEmail([email], resetEmailSubject(), resetEmailHtml(rows[0].name, link), authFrom()).then((r) =>
      audit(r.ok ? 'auth.forgot_email_ok' : 'auth.forgot_email_fail', {
        userId: uid,
        ...(r.ok ? {} : { error: r.error }),
      }),
    );
    audit('auth.forgot', { ip, found: true, userId: uid });
    /* devLink SÓ fora de produção: viabiliza o e2e completo; em prod o branch
       é morto (mesma flag PROD do cookie Secure) */
    res.json(PROD ? GENERIC_FORGOT : { ...GENERIC_FORGOT, devLink: link });
  } catch (e) {
    next(e);
  }
});

authRouter.post('/reset', async (req, res, next) => {
  try {
    if (limited('reset:' + (req.ip || 'x'), PROD ? 10 : 1000, 15 * 60_000))
      return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos.' });
    const token = String(req.body?.token ?? '');
    const password = String(req.body?.password ?? '');
    if (!/^[0-9a-f]{64}$/.test(token))
      return res.status(400).json({ error: 'Link inválido ou expirado. Peça um novo.' });
    if (password.length < 8 || password.length > 200)
      return res.status(400).json({ error: 'A senha precisa de pelo menos 8 caracteres' });

    const db = await getDB();
    const { rows } = await db.query(
      `SELECT pr.id AS rid, u.id, u.email, u.name, u.avatar
         FROM password_resets pr JOIN users u ON u.id = pr.user_id
        WHERE pr.token_hash = $1 AND pr.used_at IS NULL AND pr.expires_at > now()`,
      [sha256(token)],
    );
    if (!rows.length) return res.status(400).json({ error: 'Link inválido ou expirado. Peça um novo.' });
    const u = rows[0];

    const hash = await bcrypt.hash(password, 12); /* fora da transação (PGlite) */
    const done = await db.tx(async (q) => {
      /* consumo atômico do token — mata double-submit e corrida entre abas */
      const c = await q.query(
        'UPDATE password_resets SET used_at = now() WHERE id = $1 AND used_at IS NULL RETURNING id',
        [u.rid],
      );
      if (!c.rows.length) return false;
      await q.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, u.id]);
      await q.query('DELETE FROM sessions WHERE user_id = $1', [u.id]); /* TODAS as sessões */
      return true;
    });
    if (!done) return res.status(400).json({ error: 'Link inválido ou expirado. Peça um novo.' });
    await createSession(u.id, res);
    audit('auth.reset_ok', { userId: u.id, ip: req.ip });
    res.json({ id: u.id, email: u.email, name: u.name, avatar: u.avatar ?? null });
  } catch (e) {
    next(e);
  }
});

const AVATAR_RE = /^data:image\/(png|jpe?g|webp|gif);base64,/;

authRouter.patch('/profile', requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const name = String(req.body?.name ?? '').trim().slice(0, 80);
    const a = req.body?.avatar;
    const avatar = typeof a === 'string' && AVATAR_RE.test(a) && a.length <= 160_000 ? a : null;
    const db = await getDB();
    await db.query('UPDATE users SET name = $1, avatar = $2 WHERE id = $3', [name, avatar, req.user!.id]);
    res.json({ id: req.user!.id, email: req.user!.email, name, avatar });
  } catch (e) {
    next(e);
  }
});
