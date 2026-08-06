/* Worker de notificações — roda no mesmo processo do Express.
   PRODUTOR: expande lembretes das tarefas e enfileira no outbox genérico
   (server/notify/outbox.ts), que concentra dedupe, tetos e despacho.
   A reconciliação cancela pendings de lembretes que deixaram de existir. */

import { getDB, type DB } from '../db.js';
import { occurrences } from '../../shared/recurrence.js';
import { addDays, parseYMD } from '../../shared/dates.js';
import { localToUtc, userTodayYMD } from './tz.js';
import { emailHtml, emailSubject, whatsText, type ReminderInfo } from './templates.js';
import { dispatchDue, enqueue, type Channel } from './outbox.js';

const TICK_MS = Math.max(5_000, Number(process.env.NOTIFY_TICK_MS) || 45_000);
const LOOKAHEAD_MS = 36 * 3600_000; // produz até 36h à frente
const GRACE_MS = 10 * 60_000; // tolerância para atraso na produção

const asJson = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v);

let running = false;

export function startNotifyWorker() {
  const t = setInterval(() => void tick(), TICK_MS);
  (t as any).unref?.();
  void tick(); // primeiro tick imediato (recupera janela pós-restart)
  console.log(`Worker de notificações ativo (tick ${TICK_MS / 1000}s)`);
}

async function tick() {
  if (running) return;
  running = true;
  try {
    const db = await getDB();
    await produce(db);
    await dispatchDue(db);
  } catch (e) {
    console.error('notify tick:', e);
  } finally {
    running = false;
  }
}

/* ---------------- PRODUTOR DE LEMBRETES ---------------- */

interface SettingsRow {
  user_id: string;
  emails: unknown;
  whatsapp_number: string;
  email_enabled: boolean;
  whatsapp_enabled: boolean;
  timezone: string;
}

function userEmails(u: SettingsRow): string[] {
  const arr = asJson(u.emails);
  return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string' && x) : [];
}

async function produce(db: DB) {
  const { rows: users } = await db.query(
    `SELECT user_id, emails, whatsapp_number, email_enabled, whatsapp_enabled, timezone
       FROM notify_settings
      WHERE (email_enabled AND emails::text <> '[]')
         OR (whatsapp_enabled AND whatsapp_number <> '')`,
  );

  for (const u of users as SettingsRow[]) {
    const now = Date.now();
    const tz = u.timezone || 'America/Sao_Paulo';
    const emails = userEmails(u);
    const channels: Channel[] = [
      ...(u.email_enabled && emails.length ? (['email'] as const) : []),
      ...(u.whatsapp_enabled && u.whatsapp_number ? (['whatsapp'] as const) : []),
    ];
    if (!channels.length) continue;

    const { rows: tasks } = await db.query(
      `SELECT id, title, notes, date, time, prio, rec, done, done_dates, remind
         FROM tasks
        WHERE user_id = $1 AND remind IS NOT NULL AND date IS NOT NULL AND time IS NOT NULL`,
      [u.user_id],
    );

    /* janela de dias no fuso do usuário: ontem até +9d cobre lookahead+remind */
    const start = addDays(parseYMD(userTodayYMD(tz)), -1);
    const end = addDays(start, 10);

    const expectedKeys: string[] = [];
    for (const t of tasks) {
      const rec = asJson(t.rec) || { type: 'none', until: null };
      const doneDates: string[] = asJson(t.done_dates) || [];
      const remind = Number(t.remind);
      for (const dk of occurrences({ date: t.date, rec }, start, end)) {
        if (rec.type === 'none' ? t.done : doneDates.includes(dk)) continue;
        const fireAt = localToUtc(dk, t.time, tz).getTime() - remind * 60_000;
        if (fireAt < now - GRACE_MS || fireAt > now + LOOKAHEAD_MS) continue;
        const info: ReminderInfo = {
          title: t.title, notes: t.notes || '', prio: t.prio, dk, time: t.time, remind,
        };
        for (const ch of channels) {
          /* o minuto do disparo entra na chave: mudar hora/lembrete gera uma
             chave nova → a ocorrência re-notifica no novo horário (a linha
             antiga pendente é cancelada pela reconciliação; a já enviada
             fica no histórico) */
          const key = `${u.user_id}:${t.id}:${dk}:${ch}:${Math.floor(fireAt / 60_000)}`;
          expectedKeys.push(key);
          await enqueue({
            userId: u.user_id,
            channel: ch,
            kind: 'lembrete',
            taskId: t.id,
            dk,
            fireAt: new Date(fireAt),
            recipient: ch === 'email' ? emails.join(',') : u.whatsapp_number,
            subject: ch === 'email' ? emailSubject(info) : '',
            body: ch === 'email' ? emailHtml(info) : whatsText(info),
            dedupeKey: key,
          });
        }
      }
    }

    /* reconciliação: lembretes pendentes que deixaram de ser esperados
       (tarefa apagada/concluída, remind removido, canal desligado) */
    if (expectedKeys.length) {
      const ph = expectedKeys.map((_, i) => `$${i + 2}`).join(',');
      await db.query(
        `UPDATE notification_log SET status='canceled', last_error='removido/concluído'
          WHERE user_id = $1 AND status = 'pending' AND kind = 'lembrete' AND dedupe_key NOT IN (${ph})`,
        [u.user_id, ...expectedKeys],
      );
    } else {
      await db.query(
        `UPDATE notification_log SET status='canceled', last_error='removido/concluído'
          WHERE user_id = $1 AND status = 'pending' AND kind = 'lembrete'`,
        [u.user_id],
      );
    }
  }

  /* usuários que desligaram todos os canais não entram no loop acima */
  await db.query(
    `UPDATE notification_log SET status='canceled', last_error='canais desativados'
      WHERE status='pending' AND kind='lembrete' AND user_id NOT IN (
        SELECT user_id FROM notify_settings
         WHERE (email_enabled AND emails::text <> '[]')
            OR (whatsapp_enabled AND whatsapp_number <> ''))`,
  );
}
