/* Login com Google (OIDC, sem libs) — PREPARADO: só ativa quando
   GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET + APP_URL existirem (produção).
   Fluxo: /google redireciona com state anti-CSRF → /google/callback troca o
   code, valida o id_token via tokeninfo (aud + email_verified) e faz
   find-or-create (vínculo por google_id ou por e-mail já cadastrado). */

import crypto from 'node:crypto';
import express from 'express';
import bcrypt from 'bcryptjs';
import { getDB } from './db.js';
import { audit, createSession, readCookie } from './auth.js';
import { appUrl } from './notify/templates.js';

const PROD = process.env.NODE_ENV === 'production';
const STATE_COOKIE = 'am_oauth_state';

const googleConfigured = () =>
  !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.APP_URL);
const redirectUri = () => `${appUrl()}/api/auth/google/callback`;

async function fetchJson(url: string, init?: RequestInit): Promise<any> {
  const ac = new AbortController();
  const tm = setTimeout(() => ac.abort(), 10_000);
  try {
    const r = await fetch(url, { ...init, signal: ac.signal });
    return await r.json().catch(() => ({}));
  } finally {
    clearTimeout(tm);
  }
}

export const googleRouter = express.Router();

googleRouter.get('/providers', (_req, res) => {
  res.json({ google: googleConfigured() });
});

googleRouter.get('/google', (req, res) => {
  if (!googleConfigured())
    return res.status(503).json({
      error: 'Login com Google não configurado: defina GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET e APP_URL no servidor.',
    });
  const state = crypto.randomBytes(16).toString('hex');
  res.cookie(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: PROD,
    maxAge: 10 * 60_000,
    path: '/api/auth/google', // cobre também /google/callback
  });
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  res.redirect('https://accounts.google.com/o/oauth2/v2/auth?' + params.toString());
});

googleRouter.get('/google/callback', async (req, res, next) => {
  try {
    if (!googleConfigured()) return res.redirect('/?google=erro');
    const saved = readCookie(req, STATE_COOKIE);
    res.clearCookie(STATE_COOKIE, { path: '/api/auth/google' });
    if (!saved || saved !== String(req.query.state ?? '')) {
      audit('auth.google_state_fail', { ip: req.ip });
      return res.redirect('/?google=erro');
    }
    const code = String(req.query.code ?? '');
    if (!code) return res.redirect('/?google=erro');

    /* troca code → tokens */
    const tok = await fetchJson('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: redirectUri(),
        grant_type: 'authorization_code',
      }).toString(),
    });
    if (!tok?.id_token) {
      audit('auth.google_token_fail', { ip: req.ip });
      return res.redirect('/?google=erro');
    }

    /* valida o id_token por introspecção do próprio Google */
    const ti = await fetchJson(
      'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(tok.id_token),
    );
    const verified = ti?.email_verified === true || ti?.email_verified === 'true';
    if (String(ti?.aud ?? '') !== process.env.GOOGLE_CLIENT_ID || !verified || !ti?.sub || !ti?.email) {
      audit('auth.google_tokeninfo_fail', { ip: req.ip });
      return res.redirect('/?google=erro');
    }
    const sub = String(ti.sub);
    const email = String(ti.email).toLowerCase();
    const name = String(ti.name ?? '').slice(0, 80);

    const db = await getDB();
    let u = (await db.query('SELECT id FROM users WHERE google_id = $1', [sub])).rows[0];
    if (!u) {
      u = (await db.query('SELECT id FROM users WHERE email = $1', [email])).rows[0];
      if (u) {
        /* conta local existente ganha o vínculo */
        await db.query('UPDATE users SET google_id = $2 WHERE id = $1', [u.id, sub]);
      } else {
        /* conta nova com senha aleatória inutilizável (define via "esqueci") */
        const hash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
        const id = crypto.randomUUID();
        await db.query(
          'INSERT INTO users (id, email, name, password_hash, google_id) VALUES ($1,$2,$3,$4,$5)',
          [id, email, name, hash, sub],
        );
        u = { id };
      }
    }
    await createSession(u.id, res);
    audit('auth.google_ok', { userId: u.id, ip: req.ip });
    res.redirect('/');
  } catch (e) {
    next(e);
  }
});
