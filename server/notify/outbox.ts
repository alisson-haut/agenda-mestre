/* ============================================================
   OUTBOX GENÉRICO DE MENSAGERIA — e-mail (Resend) e WhatsApp (Evolution GO)

   Qualquer recurso do sistema enfileira por aqui (enqueue) e o worker
   despacha (dispatchDue) com defesa em profundidade contra disparos
   desenfreados — proteção do número de WhatsApp e das cotas do Resend:

   1. Dedupe por chave única        — a mesma notificação nunca sai 2x
   2. Teto de fila por usuário      — bug produtor não explode a fila
   3. Cap por tick e por canal      — vazão máxima absoluta do sistema
   4. Janela deslizante por usuário — rajadas por minuto são adiadas
   5. Teto diário por usuário       — volume/24h por canal
   6. Teto GLOBAL diário de e-mail  — nunca estoura a cota do Resend
   7. Espaçamento entre WhatsApps   — sem metralhadora (padrão anti-ban)
   8. Circuit breaker por canal     — provedor falhando ≥5x seguidas
                                       pausa o canal por 5 min
   9. Expiração de janela           — atrasado demais é cancelado, nunca
                                       enviado em rajada tardia
   Adiar por limite NÃO consome tentativa; os limites são ajustáveis por env.
   ============================================================ */

import crypto from 'node:crypto';
import { getDB, type DB } from '../db.js';
import { resendConfigured, sendEmail } from './resend.js';
import { evo, evoConfigured } from './evolution.js';

export type Channel = 'email' | 'whatsapp';

const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : d;
};

export const LIMITS = {
  /* máximo despachado por canal a cada tick do worker */
  perTick: num(process.env.NOTIFY_TICK_CHANNEL_MAX, 10),
  wa: {
    windowMax: num(process.env.NOTIFY_WA_WINDOW_MAX, 6), // por usuário/60s
    windowS: 60,
    dailyMax: num(process.env.NOTIFY_WA_DAILY_CAP, 250), // por usuário/24h
    gapMs: num(process.env.NOTIFY_WA_GAP_MS, 1500), // espaçamento entre envios
  },
  email: {
    windowMax: num(process.env.NOTIFY_EMAIL_WINDOW_MAX, 10),
    windowS: 60,
    dailyMax: num(process.env.NOTIFY_EMAIL_DAILY_CAP, 80),
    gapMs: 0,
  },
  /* teto global/24h de e-mail (plano free do Resend = 100/dia) */
  emailGlobalDaily: num(process.env.NOTIFY_EMAIL_GLOBAL_CAP, 95),
  /* fila pendente máxima por usuário+canal */
  pendingMax: num(process.env.NOTIFY_PENDING_MAX, 60),
  maxAttempts: 3,
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ---------------- circuit breaker por canal (em memória) ---------------- */
const BREAKER_THRESHOLD = 5;
const BREAKER_COOLDOWN_MS = 5 * 60_000;
const breaker: Record<Channel, { fails: number; openUntil: number }> = {
  email: { fails: 0, openUntil: 0 },
  whatsapp: { fails: 0, openUntil: 0 },
};
const breakerOpen = (ch: Channel) => Date.now() < breaker[ch].openUntil;
function breakerReport(ch: Channel, ok: boolean) {
  const b = breaker[ch];
  if (ok) {
    b.fails = 0;
    return;
  }
  if (++b.fails >= BREAKER_THRESHOLD) {
    b.openUntil = Date.now() + BREAKER_COOLDOWN_MS;
    b.fails = 0;
    console.warn(`outbox: circuito do canal ${ch} aberto por 5 min (falhas consecutivas no provedor)`);
  }
}

/* ---------------- API de enfileiramento ---------------- */

export interface EnqueueInput {
  userId: string;
  channel: Channel;
  /** categoria da mensagem — 'lembrete' (padrão) tem janela de 10 min;
      outros kinds têm 24h antes de expirar */
  kind?: string;
  taskId?: string;
  dk?: string;
  fireAt: Date;
  recipient: string; // e-mail(s) separados por vírgula | número só dígitos
  subject?: string;
  body: string; // html (email) | texto (whatsapp)
  dedupeKey: string;
}

/** Enfileira uma notificação (idempotente por dedupeKey). Enquanto pending,
 *  re-enfileirar atualiza conteúdo/horário; depois de sent vira no-op. */
export async function enqueue(n: EnqueueInput): Promise<'queued' | 'skipped_full'> {
  const db = await getDB();
  const { rows } = await db.query(
    `SELECT count(*)::int AS c FROM notification_log WHERE user_id=$1 AND channel=$2 AND status='pending'`,
    [n.userId, n.channel],
  );
  if (Number(rows[0]?.c ?? 0) >= LIMITS.pendingMax) {
    console.warn(`outbox: fila pendente cheia (${n.userId}/${n.channel}) — descartando ${n.dedupeKey}`);
    return 'skipped_full';
  }
  await db.query(
    `INSERT INTO notification_log (id, user_id, task_id, dk, fire_at, channel, kind, recipient, subject, body, dedupe_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (dedupe_key) DO UPDATE
       SET fire_at = EXCLUDED.fire_at, recipient = EXCLUDED.recipient,
           subject = EXCLUDED.subject, body = EXCLUDED.body
     WHERE notification_log.status = 'pending'`,
    [
      crypto.randomUUID(), n.userId, n.taskId ?? '', n.dk ?? '', n.fireAt.toISOString(),
      n.channel, n.kind ?? 'lembrete', n.recipient, n.subject ?? '', n.body, n.dedupeKey,
    ],
  );
  return 'queued';
}

/* ---------------- portões de limite (adiam, não falham) ---------------- */

async function sentInWindow(db: DB, userId: string, ch: Channel, seconds: number): Promise<number> {
  const { rows } = await db.query(
    `SELECT count(*)::int AS c FROM notification_log
      WHERE user_id=$1 AND channel=$2 AND status='sent' AND sent_at > now() - interval '${seconds} seconds'`,
    [userId, ch],
  );
  return Number(rows[0]?.c ?? 0);
}

async function gateFor(db: DB, n: any): Promise<{ reason: string; retryMs: number } | null> {
  const ch = n.channel as Channel;
  const cfg = ch === 'whatsapp' ? LIMITS.wa : LIMITS.email;
  if ((await sentInWindow(db, n.user_id, ch, cfg.windowS)) >= cfg.windowMax)
    return { reason: `adiado: limite por minuto (${cfg.windowMax}/${cfg.windowS}s)`, retryMs: cfg.windowS * 1000 };
  if ((await sentInWindow(db, n.user_id, ch, 24 * 3600)) >= cfg.dailyMax)
    return { reason: `adiado: teto diário do canal (${cfg.dailyMax}/24h)`, retryMs: 3600_000 };
  if (ch === 'email') {
    const { rows } = await db.query(
      `SELECT count(*)::int AS c FROM notification_log
        WHERE channel='email' AND status='sent' AND sent_at > now() - interval '24 hours'`,
    );
    if (Number(rows[0]?.c ?? 0) >= LIMITS.emailGlobalDaily)
      return { reason: `adiado: teto global de e-mail (${LIMITS.emailGlobalDaily}/24h — cota Resend)`, retryMs: 3600_000 };
  }
  return null;
}

/* ---------------- despacho ---------------- */

async function sendOne(db: DB, n: any): Promise<{ ok: true; id?: string } | { ok: false; error: string }> {
  if (n.channel === 'email') {
    return sendEmail(String(n.recipient).split(',').filter(Boolean), n.subject, n.body);
  }
  if (n.channel === 'whatsapp') {
    const { rows } = await db.query(`SELECT wa_instance_token FROM notify_settings WHERE user_id=$1`, [n.user_id]);
    const token = rows[0]?.wa_instance_token;
    if (!token) return { ok: false, error: 'WhatsApp não conectado (sem instância)' };
    const r = await evo.sendText(token, n.recipient, n.body);
    if (!r.ok) return { ok: false, error: r.error };
    const id = r.data?.Info?.ID ?? r.data?.info?.id ?? r.data?.key?.id ?? r.data?.id ?? null;
    return { ok: true, id: typeof id === 'string' ? id : undefined };
  }
  return { ok: false, error: `canal desconhecido: ${n.channel}` };
}

export async function dispatchDue(db: DB) {
  /* lease-recovery: 'sending' órfão (crash no meio do envio) volta a pending */
  await db.query(`UPDATE notification_log SET status='pending' WHERE status='sending' AND next_attempt_at < now()`);
  /* expiração de janela: lembrete atrasado >10min nunca envia; outros kinds
     ganham 24h (mensagens menos sensíveis a horário) */
  await db.query(
    `UPDATE notification_log SET status='canceled', last_error='janela perdida'
      WHERE status='pending' AND (
        (kind='lembrete' AND fire_at < now() - interval '10 minutes')
        OR fire_at < now() - interval '24 hours')`,
  );

  for (const ch of ['email', 'whatsapp'] as Channel[]) {
    if (breakerOpen(ch)) continue;
    /* sem provedor configurado não claima — não queima tentativas à toa */
    if (ch === 'email' && !resendConfigured()) continue;
    if (ch === 'whatsapp' && !evoConfigured()) continue;

    const { rows } = await db.query(
      `UPDATE notification_log
          SET status='sending', attempts = attempts + 1, next_attempt_at = now() + interval '5 minutes'
        WHERE id IN (
          SELECT id FROM notification_log
           WHERE status='pending' AND channel=$1 AND fire_at <= now() AND next_attempt_at <= now()
           ORDER BY fire_at LIMIT ${LIMITS.perTick})
        RETURNING *`,
      [ch],
    );

    for (const n of rows) {
      /* portões de limite: adiar devolve para pending SEM consumir tentativa */
      const gate = await gateFor(db, n);
      if (gate) {
        await db.query(
          `UPDATE notification_log SET status='pending', attempts = attempts - 1, last_error=$2, next_attempt_at=$3 WHERE id=$1`,
          [n.id, gate.reason, new Date(Date.now() + gate.retryMs).toISOString()],
        );
        continue;
      }

      const r = await sendOne(db, n);
      breakerReport(ch, r.ok);
      if (r.ok) {
        await db.query(
          `UPDATE notification_log SET status='sent', sent_at=now(), provider_message_id=$2, last_error=NULL WHERE id=$1`,
          [n.id, r.id ?? null],
        );
        const cfg = ch === 'whatsapp' ? LIMITS.wa : LIMITS.email;
        if (cfg.gapMs) await sleep(cfg.gapMs); // espaçamento anti-rajada
      } else if (Number(n.attempts) >= LIMITS.maxAttempts) {
        await db.query(`UPDATE notification_log SET status='failed', last_error=$2 WHERE id=$1`, [n.id, r.error]);
        console.error(`notificação falhou (${n.channel} · ${n.dedupe_key}):`, r.error);
      } else {
        /* backoff persistido: 1min, 2min */
        await db.query(
          `UPDATE notification_log SET status='pending', last_error=$2, next_attempt_at=$3 WHERE id=$1`,
          [n.id, r.error, new Date(Date.now() + Number(n.attempts) * 60_000).toISOString()],
        );
      }
      if (breakerOpen(ch)) break; // circuito abriu no meio do lote → para
    }
  }
}
