/* Cofre Secrets — ZERO-KNOWLEDGE.
   O servidor NUNCA vê: senha-mestra, chave de cifra (EK) ou plaintext.
   O que chega aqui: authKey (derivado one-way no cliente: PBKDF2→HKDF),
   salt/iterations (públicos por design) e ciphertexts AES-GCM opacos —
   título/segmento ficam DENTRO do ciphertext, nada em claro no banco.
   Guardamos bcrypt(authKey) como verificador: nem o banco vazado permite
   ler os itens sem quebrar o PBKDF2 de 600k iterações da senha-mestra.

   Unlock devolve um token efêmero (2min, TTL deslizante) usado nos writes
   via header X-Vault-Token. O Map em memória pressupõe UM processo (é o
   caso: um container). Restart do servidor = cofre trava, cliente re-pede
   a senha — inofensivo. NUNCA logar authKey/token/ciphertext. */

import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import express from 'express';
import { getDB } from './db.js';
import { requireAuth, limited, audit, type AuthedRequest } from './auth.js';

const TOKEN_TTL_MS = 2 * 60_000;
const MAX_ITEMS = 500;
const MAX_CIPHER = 32_000;
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const HEX_RE = /^[0-9a-f]{64}$/;
const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

/* tokens de cofre destravado: sha256(token) → { userId, exp } */
const vaultTokens = new Map<string, { userId: string; exp: number }>();

function gcTokens() {
  const now = Date.now();
  for (const [k, v] of vaultTokens) if (v.exp < now) vaultTokens.delete(k);
}

function issueToken(userId: string): { token: string; expiresAt: number } {
  gcTokens();
  const token = crypto.randomBytes(32).toString('hex');
  const exp = Date.now() + TOKEN_TTL_MS;
  vaultTokens.set(sha256(token), { userId, exp });
  return { token, expiresAt: exp };
}

function invalidateUserTokens(userId: string) {
  for (const [k, v] of vaultTokens) if (v.userId === userId) vaultTokens.delete(k);
}

/* middleware dos writes de itens: cookie de sessão E token de cofre válido */
function requireVault(req: AuthedRequest, res: express.Response, next: express.NextFunction) {
  const t = String(req.headers['x-vault-token'] || '');
  const rec = t ? vaultTokens.get(sha256(t)) : undefined;
  const now = Date.now();
  if (!rec || rec.userId !== req.user!.id || rec.exp < now)
    return res.status(401).json({ error: 'Cofre bloqueado', code: 'vault_locked' });
  rec.exp = now + TOKEN_TTL_MS; /* TTL deslizante, alinhado ao modal */
  next();
}

function cleanCipher(b: any): { ciphertext: string; iv: string } {
  const ciphertext = String(b?.ciphertext ?? '');
  const iv = String(b?.iv ?? '');
  if (!ciphertext || ciphertext.length > MAX_CIPHER || !B64_RE.test(ciphertext))
    throw new Error('Item cifrado inválido.');
  /* iv AES-GCM de 12 bytes = 16 chars base64 */
  if (iv.length !== 16 || !B64_RE.test(iv)) throw new Error('Item cifrado inválido.');
  return { ciphertext, iv };
}

const pubItem = (r: any) => ({
  id: r.id,
  ciphertext: r.ciphertext,
  iv: r.iv,
  created: Number(r.created) || 0,
  updated: Number(r.updated) || 0,
});

export const secretsRouter = express.Router();
secretsRouter.use(requireAuth);

secretsRouter.get('/vault', async (req: AuthedRequest, res, next) => {
  try {
    const db = await getDB();
    const { rows } = await db.query('SELECT salt, iterations FROM secrets_vault WHERE user_id = $1', [
      req.user!.id,
    ]);
    if (!rows.length) return res.json({ exists: false });
    res.json({ exists: true, salt: rows[0].salt, iterations: Number(rows[0].iterations) });
  } catch (e) {
    next(e);
  }
});

secretsRouter.post('/vault', async (req: AuthedRequest, res, next) => {
  try {
    const uid = req.user!.id;
    const authKey = String(req.body?.authKey ?? '');
    const salt = String(req.body?.salt ?? '');
    const iterations = Math.round(Number(req.body?.iterations));
    if (!HEX_RE.test(authKey) || !HEX_RE.test(salt) || !(iterations >= 100_000 && iterations <= 5_000_000))
      return res.status(400).json({ error: 'Dados inválidos' });
    const hash = await bcrypt.hash(authKey, 12); /* fora de tx (PGlite) */
    const db = await getDB();
    const { rows } = await db.query(
      `INSERT INTO secrets_vault (user_id, auth_hash, salt, iterations)
       VALUES ($1,$2,$3,$4) ON CONFLICT (user_id) DO NOTHING RETURNING user_id`,
      [uid, hash, salt, iterations],
    );
    if (!rows.length) return res.status(409).json({ error: 'O cofre já existe.' });
    audit('secrets.vault_created', { userId: uid });
    res.json({ ...issueToken(uid), items: [] });
  } catch (e) {
    next(e);
  }
});

secretsRouter.post('/unlock', async (req: AuthedRequest, res, next) => {
  try {
    const uid = req.user!.id;
    const key = 'vault:' + (req.ip || 'x') + ':' + uid;
    if (limited(key, 5, 15 * 60_000))
      return res.status(429).json({ error: 'Muitas tentativas. Aguarde 15 minutos.' });
    const authKey = String(req.body?.authKey ?? '');
    const db = await getDB();
    const { rows } = await db.query('SELECT auth_hash FROM secrets_vault WHERE user_id = $1', [uid]);
    if (!rows.length) return res.status(404).json({ error: 'Cofre não configurado.' });
    if (!HEX_RE.test(authKey) || !(await bcrypt.compare(authKey, rows[0].auth_hash))) {
      audit('secrets.unlock_fail', { userId: uid, ip: req.ip });
      return res.status(401).json({ error: 'Senha do cofre incorreta' });
    }
    audit('secrets.unlock_ok', { userId: uid });
    const items = (
      await db.query('SELECT * FROM secrets_items WHERE user_id = $1 ORDER BY created', [uid])
    ).rows.map(pubItem);
    res.json({ ...issueToken(uid), items });
  } catch (e) {
    next(e);
  }
});

secretsRouter.post('/items', requireVault, async (req: AuthedRequest, res, next) => {
  try {
    const uid = req.user!.id;
    const id = String(req.body?.id ?? '');
    if (!ID_RE.test(id)) return res.status(400).json({ error: 'Dados inválidos' });
    let c;
    try {
      c = cleanCipher(req.body);
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }
    const db = await getDB();
    const { rows: cnt } = await db.query('SELECT COUNT(*)::int AS n FROM secrets_items WHERE user_id = $1', [uid]);
    if ((Number(cnt[0]?.n) || 0) >= MAX_ITEMS)
      return res.status(413).json({ error: 'Limite de itens do cofre atingido.' });
    const now = Date.now();
    const { rows } = await db.query(
      `INSERT INTO secrets_items (user_id, id, ciphertext, iv, created, updated)
       VALUES ($1,$2,$3,$4,$5,$5) ON CONFLICT (user_id, id) DO NOTHING RETURNING id`,
      [uid, id, c.ciphertext, c.iv, now],
    );
    if (!rows.length) return res.status(409).json({ error: 'Item já existe.' });
    res.json({ item: { id, ...c, created: now, updated: now } });
  } catch (e) {
    next(e);
  }
});

secretsRouter.put('/items/:id', requireVault, async (req: AuthedRequest, res, next) => {
  try {
    let c;
    try {
      c = cleanCipher(req.body);
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }
    const db = await getDB();
    const now = Date.now();
    const { rows } = await db.query(
      `UPDATE secrets_items SET ciphertext=$3, iv=$4, updated=$5 WHERE user_id=$1 AND id=$2 RETURNING created`,
      [req.user!.id, String(req.params.id).slice(0, 40), c.ciphertext, c.iv, now],
    );
    if (!rows.length) return res.status(404).json({ error: 'Item não encontrado.' });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

secretsRouter.delete('/items/:id', requireVault, async (req: AuthedRequest, res, next) => {
  try {
    const db = await getDB();
    const { rows } = await db.query(
      'DELETE FROM secrets_items WHERE user_id = $1 AND id = $2 RETURNING id',
      [req.user!.id, String(req.params.id).slice(0, 40)],
    );
    if (!rows.length) return res.status(404).json({ error: 'Item não encontrado.' });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/* troca de senha-mestra: o cliente re-cifra TUDO e manda o conjunto novo.
   Exige authKey ANTIGO fresco (não aceita token) — e é atômico. */
secretsRouter.post('/rekey', async (req: AuthedRequest, res, next) => {
  try {
    const uid = req.user!.id;
    const key = 'vault:' + (req.ip || 'x') + ':' + uid;
    if (limited(key, 5, 15 * 60_000))
      return res.status(429).json({ error: 'Muitas tentativas. Aguarde 15 minutos.' });
    const authKey = String(req.body?.authKey ?? '');
    const newAuthKey = String(req.body?.newAuthKey ?? '');
    const newSalt = String(req.body?.newSalt ?? '');
    const newIterations = Math.round(Number(req.body?.newIterations));
    if (!HEX_RE.test(newAuthKey) || !HEX_RE.test(newSalt) || !(newIterations >= 100_000 && newIterations <= 5_000_000))
      return res.status(400).json({ error: 'Dados inválidos' });
    let items: { id: string; ciphertext: string; iv: string }[];
    try {
      items = (Array.isArray(req.body?.items) ? req.body.items : []).map((i: any) => {
        const id = String(i?.id ?? '');
        if (!ID_RE.test(id)) throw new Error('Dados inválidos');
        return { id, ...cleanCipher(i) };
      });
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }
    const db = await getDB();
    const { rows } = await db.query('SELECT auth_hash FROM secrets_vault WHERE user_id = $1', [uid]);
    if (!rows.length) return res.status(404).json({ error: 'Cofre não configurado.' });
    if (!HEX_RE.test(authKey) || !(await bcrypt.compare(authKey, rows[0].auth_hash))) {
      audit('secrets.rekey_fail', { userId: uid, ip: req.ip });
      return res.status(401).json({ error: 'Senha do cofre incorreta' });
    }
    const newHash = await bcrypt.hash(newAuthKey, 12); /* fora de tx */
    try {
      await db.tx(async (q) => {
        /* o conjunto de ids enviado precisa bater com o atual — protege
           contra item criado em outra aba durante o rekey */
        const atuais = (await q.query('SELECT id FROM secrets_items WHERE user_id = $1', [uid])).rows
          .map((r) => r.id)
          .sort();
        const enviados = items.map((i) => i.id).sort();
        if (atuais.length !== enviados.length || atuais.some((id, i) => id !== enviados[i]))
          throw new Error('conjunto-mudou');
        await q.query(
          'UPDATE secrets_vault SET auth_hash=$2, salt=$3, iterations=$4, updated_at=now() WHERE user_id=$1',
          [uid, newHash, newSalt, newIterations],
        );
        await q.query('DELETE FROM secrets_items WHERE user_id = $1', [uid]);
        const now = Date.now();
        for (const it of items)
          await q.query(
            'INSERT INTO secrets_items (user_id, id, ciphertext, iv, created, updated) VALUES ($1,$2,$3,$4,$5,$5)',
            [uid, it.id, it.ciphertext, it.iv, now],
          );
      });
    } catch (e: any) {
      if (e?.message === 'conjunto-mudou')
        return res.status(409).json({ error: 'O cofre mudou em outro dispositivo. Recarregue e tente de novo.' });
      throw e;
    }
    invalidateUserTokens(uid);
    audit('secrets.rekey_ok', { userId: uid });
    res.json({ ...issueToken(uid) });
  } catch (e) {
    next(e);
  }
});

/* "esqueci a senha-mestra": zero-knowledge não tem recuperação — apaga tudo.
   Não usa a senha da conta (contas Google têm senha aleatória). */
secretsRouter.delete('/vault', async (req: AuthedRequest, res, next) => {
  try {
    const uid = req.user!.id;
    if (String(req.body?.confirm ?? '') !== 'APAGAR TUDO')
      return res.status(400).json({ error: 'Confirmação inválida.' });
    if (limited('vreset:' + uid, 3, 15 * 60_000))
      return res.status(429).json({ error: 'Muitas tentativas. Aguarde 15 minutos.' });
    const db = await getDB();
    const { rows } = await db.query('DELETE FROM secrets_vault WHERE user_id = $1 RETURNING user_id', [uid]);
    if (!rows.length) return res.status(404).json({ error: 'Cofre não configurado.' });
    await db.query('DELETE FROM secrets_items WHERE user_id = $1', [uid]);
    invalidateUserTokens(uid);
    audit('secrets.reset', { userId: uid });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});
