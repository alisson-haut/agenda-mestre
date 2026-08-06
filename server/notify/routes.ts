import crypto from 'node:crypto';
import express from 'express';
import { getDB } from '../db.js';
import { EMAIL_RE, limited, requireAuth, type AuthedRequest } from '../auth.js';
import { evo, evoConfigured, isDisconnectedOk, isLoggedInError, isNoQrError, revive } from './evolution.js';
import { resendConfigured, sendEmail } from './resend.js';
import { emailHtml, emailSubject, whatsText, type ReminderInfo } from './templates.js';
import { isValidTz, userTodayYMD } from './tz.js';

const asJson = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v);

async function ensureSettings(userId: string) {
  const db = await getDB();
  const sel = () => db.query('SELECT * FROM notify_settings WHERE user_id = $1', [userId]);
  let { rows } = await sel();
  if (!rows.length) {
    await db.query('INSERT INTO notify_settings (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING', [userId]);
    rows = (await sel()).rows;
  }
  return rows[0];
}

function pub(s: any) {
  return {
    emails: (asJson(s.emails) as string[]) || [],
    whatsappNumber: s.whatsapp_number || '',
    emailEnabled: !!s.email_enabled,
    whatsappEnabled: !!s.whatsapp_enabled,
    timezone: s.timezone || 'America/Sao_Paulo',
    waInstance: !!s.wa_instance_token,
    providers: { email: resendConfigured(), whatsapp: evoConfigured() },
  };
}

/* horário atual HH:MM no fuso do usuário (para a mensagem de teste) */
function nowHM(tz: string): string {
  try {
    return new Intl.DateTimeFormat('pt-BR', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
  } catch {
    return '12:00';
  }
}

function testInfo(tz: string): ReminderInfo {
  return {
    title: 'Teste de lembrete do AgendaMestre',
    notes: 'Se esta mensagem chegou, suas notificações estão funcionando. 🎉',
    prio: 'media',
    dk: userTodayYMD(tz),
    time: nowHM(tz),
    remind: 0,
  };
}

const guardEvo = (res: express.Response) => {
  if (evoConfigured()) return false;
  res.status(503).json({ error: 'WhatsApp não configurado: defina EVOLUTION_BASE_URL e EVOLUTION_API_KEY no servidor.' });
  return true;
};
const guardResend = (res: express.Response) => {
  if (resendConfigured()) return false;
  res.status(503).json({ error: 'E-mail não configurado: defina RESEND_API_KEY e RESEND_FROM no servidor.' });
  return true;
};

export const notifyRouter = express.Router();
notifyRouter.use(requireAuth);

/* histórico de envios do usuário (diagnóstico) */
notifyRouter.get('/log', async (req: AuthedRequest, res, next) => {
  try {
    const db = await getDB();
    const { rows } = await db.query(
      `SELECT task_id, dk, fire_at, channel, kind, recipient, status, attempts, last_error, sent_at, created_at
         FROM notification_log WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30`,
      [req.user!.id],
    );
    res.json({ log: rows });
  } catch (e) {
    next(e);
  }
});

notifyRouter.get('/settings', async (req: AuthedRequest, res, next) => {
  try {
    res.json(pub(await ensureSettings(req.user!.id)));
  } catch (e) {
    next(e);
  }
});

notifyRouter.put('/settings', async (req: AuthedRequest, res, next) => {
  try {
    const b = req.body ?? {};
    const emails = (Array.isArray(b.emails) ? b.emails : [])
      .map((e: unknown) => String(e ?? '').trim().toLowerCase())
      .filter((e: string) => e && EMAIL_RE.test(e) && e.length <= 200)
      .slice(0, 3);
    const num = String(b.whatsappNumber ?? '').replace(/\D/g, '').slice(0, 15);
    if (num && num.length < 10)
      return res.status(400).json({ error: 'Número de WhatsApp inválido — use DDI+DDD+número (ex.: 5541999999999).' });
    const cur = await ensureSettings(req.user!.id);
    const tz = isValidTz(String(b.timezone ?? '')) ? String(b.timezone) : cur.timezone || 'America/Sao_Paulo';
    const db = await getDB();
    await db.query(
      `UPDATE notify_settings
          SET emails=$2, whatsapp_number=$3, email_enabled=$4, whatsapp_enabled=$5, timezone=$6, updated_at=now()
        WHERE user_id=$1`,
      [req.user!.id, JSON.stringify(emails), num, !!b.emailEnabled && emails.length > 0, !!b.whatsappEnabled, tz],
    );
    res.json(pub(await ensureSettings(req.user!.id)));
  } catch (e) {
    next(e);
  }
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function findInstanceByName(name: string): Promise<any | null> {
  const all = await evo.all();
  if (!all.ok || !Array.isArray(all.data)) return null;
  return all.data.find((i: any) => (i.name ?? i.instanceName) === name) ?? null;
}

/* cria a instância e persiste o token; no Evolution GO o QR já fica
   disponível logo após o create — não chamar connect em seguida */
async function createFresh(db: any, uid: string): Promise<{ token: string } | { error: string }> {
  const name = 'agendamestre-' + uid.replace(/-/g, '').slice(0, 8);
  const token = crypto.randomUUID();
  let created = await evo.create(name, token);
  if (!created.ok) {
    /* nome já existe (estado perdido) → apaga e recria com o token novo */
    const found = await findInstanceByName(name);
    if (found?.id) {
      await evo.remove(found.id);
      await sleep(500);
      created = await evo.create(name, token);
    }
    if (!created.ok) return { error: created.error };
  }
  await db.query(
    'UPDATE notify_settings SET wa_instance_name=$2, wa_instance_token=$3, updated_at=now() WHERE user_id=$1',
    [uid, name, token],
  );
  return { token };
}

/* a capitalização das chaves varia entre builds do Evolution GO
   (ex.: status devolve Connected/LoggedIn, qr devolve qrcode/code) */
const qrOf = (r: any) => (r.ok ? r.data?.Qrcode || r.data?.qrcode || null : null);
const hasQr = (r: any) => !!qrOf(r);
const boolOf = (d: any, ...keys: string[]) => keys.some((k) => !!d?.[k]);

/* prepara a instância para exibir o QR — cria, revive ou recria conforme o caso */
notifyRouter.post('/whatsapp/connect', async (req: AuthedRequest, res, next) => {
  try {
    if (guardEvo(res)) return;
    const uid = req.user!.id;
    const db = await getDB();
    const s = await ensureSettings(uid);

    if (!s.wa_instance_token) {
      const r = await createFresh(db, uid);
      if ('error' in r) return res.status(502).json({ error: 'Falha ao criar a instância: ' + r.error });
      return res.json({ connected: false, loggedIn: false });
    }

    /* já logada? */
    const st = await evo.status(s.wa_instance_token);
    if (st.ok && boolOf(st.data, 'LoggedIn', 'loggedIn')) return res.json({ connected: true, loggedIn: true });

    /* QR já disponível? */
    const q1 = await evo.qr(s.wa_instance_token);
    if (hasQr(q1)) return res.json({ connected: false, loggedIn: false });
    if (isLoggedInError(q1)) return res.json({ connected: true, loggedIn: true });

    /* sem QR: revive (logout tolerante → connect) e re-testa */
    await revive(s.wa_instance_token);
    await sleep(1200);
    const q2 = await evo.qr(s.wa_instance_token);
    if (hasQr(q2)) return res.json({ connected: false, loggedIn: false });
    if (isLoggedInError(q2)) return res.json({ connected: true, loggedIn: true });

    /* sessão esgotada (ex.: orçamento de 5 QRs do Evolution GO) → recria do zero */
    const found = await findInstanceByName(s.wa_instance_name);
    if (found?.id) {
      await evo.remove(found.id);
      await sleep(500);
    }
    const r = await createFresh(db, uid);
    if ('error' in r) return res.status(502).json({ error: 'Falha ao recriar a instância: ' + r.error });
    res.json({ connected: false, loggedIn: false });
  } catch (e) {
    next(e);
  }
});

/* proxy do QR — o token da instância nunca chega ao navegador */
notifyRouter.get('/whatsapp/qr', async (req: AuthedRequest, res, next) => {
  try {
    if (guardEvo(res)) return;
    const s = await ensureSettings(req.user!.id);
    if (!s.wa_instance_token) return res.status(400).json({ error: 'Inicie a conexão primeiro.' });
    const r = await evo.qr(s.wa_instance_token);
    if (r.ok) {
      const qr = qrOf(r);
      if (!qr) return res.json({ pending: true });
      return res.json({ qr });
    }
    if (isLoggedInError(r)) return res.json({ connected: true });
    if (isNoQrError(r)) return res.json({ pending: true });
    res.status(502).json({ error: 'Falha ao obter o QR: ' + r.error });
  } catch (e) {
    next(e);
  }
});

notifyRouter.get('/whatsapp/status', async (req: AuthedRequest, res, next) => {
  try {
    if (guardEvo(res)) return;
    const s = await ensureSettings(req.user!.id);
    if (!s.wa_instance_token) return res.json({ linked: false, connected: false, loggedIn: false });
    const r = await evo.status(s.wa_instance_token);
    if (!r.ok) return res.json({ linked: true, connected: false, loggedIn: false, error: r.error });
    res.json({
      linked: true,
      connected: boolOf(r.data, 'Connected', 'connected'),
      loggedIn: boolOf(r.data, 'LoggedIn', 'loggedIn'),
    });
  } catch (e) {
    next(e);
  }
});

notifyRouter.delete('/whatsapp', async (req: AuthedRequest, res, next) => {
  try {
    if (guardEvo(res)) return;
    const uid = req.user!.id;
    const s = await ensureSettings(uid);
    if (s.wa_instance_token) {
      const lo = await evo.logout(s.wa_instance_token);
      if (!lo.ok && !isDisconnectedOk(lo) && lo.status !== 404)
        console.warn('logout Evolution:', lo.error);
      const all = await evo.all();
      const found =
        all.ok && Array.isArray(all.data)
          ? all.data.find((i: any) => (i.name ?? i.instanceName) === s.wa_instance_name)
          : null;
      if (found?.id) await evo.remove(found.id);
    }
    const db = await getDB();
    await db.query(
      `UPDATE notify_settings SET wa_instance_name=NULL, wa_instance_token=NULL, whatsapp_enabled=false, updated_at=now() WHERE user_id=$1`,
      [uid],
    );
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

notifyRouter.post('/test/email', async (req: AuthedRequest, res, next) => {
  try {
    if (guardResend(res)) return;
    if (limited('ntest:' + req.user!.id, 5)) return res.status(429).json({ error: 'Muitos testes. Aguarde alguns minutos.' });
    const s = await ensureSettings(req.user!.id);
    const emails = (asJson(s.emails) as string[]) || [];
    if (!emails.length) return res.status(400).json({ error: 'Salve ao menos um e-mail antes de testar.' });
    const info = testInfo(s.timezone);
    const r = await sendEmail(emails, emailSubject(info), emailHtml(info));
    if (!r.ok) return res.status(502).json({ error: r.error });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

notifyRouter.post('/test/whatsapp', async (req: AuthedRequest, res, next) => {
  try {
    if (guardEvo(res)) return;
    if (limited('ntest:' + req.user!.id, 5)) return res.status(429).json({ error: 'Muitos testes. Aguarde alguns minutos.' });
    const s = await ensureSettings(req.user!.id);
    if (!s.wa_instance_token) return res.status(400).json({ error: 'Conecte o WhatsApp por QR code antes de testar.' });
    if (!s.whatsapp_number) return res.status(400).json({ error: 'Salve o número de destino antes de testar.' });
    const r = await evo.sendText(s.wa_instance_token, s.whatsapp_number, whatsText(testInfo(s.timezone)));
    if (!r.ok) return res.status(502).json({ error: 'Envio falhou: ' + r.error });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});
