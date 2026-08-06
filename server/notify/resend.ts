/* Envio de e-mail via Resend (https://resend.com/docs/api-reference/emails/send-email).
   Sem retry interno — o retry com backoff é responsabilidade do worker. */

export const resendConfigured = () => !!(process.env.RESEND_API_KEY && process.env.RESEND_FROM);

export async function sendEmail(
  to: string[],
  subject: string,
  html: string,
  fromOverride?: string,
): Promise<{ ok: true; id?: string } | { ok: false; error: string }> {
  const key = process.env.RESEND_API_KEY;
  const from = fromOverride || process.env.RESEND_FROM;
  if (!key || !from) return { ok: false, error: 'Resend não configurado (RESEND_API_KEY/RESEND_FROM)' };
  if (!to.length) return { ok: false, error: 'Nenhum destinatário' };
  const ac = new AbortController();
  const tm = setTimeout(() => ac.abort(), 10_000);
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, html }),
      signal: ac.signal,
    });
    const body: any = await r.json().catch(() => ({}));
    if (!r.ok)
      return {
        ok: false,
        error: `Resend ${r.status}: ${String(body?.message || body?.error?.message || body?.name || '').slice(0, 300)}`,
      };
    return { ok: true, id: typeof body?.id === 'string' ? body.id : undefined };
  } catch (e: any) {
    return { ok: false, error: 'Resend: ' + String(e?.message || e).slice(0, 200) };
  } finally {
    clearTimeout(tm);
  }
}
