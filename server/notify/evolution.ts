/* Cliente Evolution GO v3 (gateway WhatsApp).
   Auth por header `apikey`: chave GLOBAL para create/all/delete; TOKEN da
   instância para o resto. Envelope {ok,...} sem exceptions; timeout 10s;
   retry 2x só em 5xx (backoff 200ms/600ms). */

export type EvoResult<T = any> = { ok: true; data: T } | { ok: false; error: string; status?: number };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const evoConfigured = () => !!(process.env.EVOLUTION_BASE_URL && process.env.EVOLUTION_API_KEY);

async function evoFetch(
  path: string,
  opts: { method?: string; body?: unknown; token?: string } = {},
): Promise<EvoResult> {
  const base = (process.env.EVOLUTION_BASE_URL || '').replace(/\/+$/, '');
  const key = opts.token ?? process.env.EVOLUTION_API_KEY;
  if (!base || !key) return { ok: false, error: 'Evolution não configurado (EVOLUTION_BASE_URL/EVOLUTION_API_KEY)' };

  for (let attempt = 0; attempt <= 2; attempt++) {
    const ac = new AbortController();
    const tm = setTimeout(() => ac.abort(), 10_000);
    try {
      const r = await fetch(base + path, {
        method: opts.method || 'GET',
        headers: { apikey: key, ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: ac.signal,
      });
      const text = await r.text();
      let parsed: any = {};
      try {
        parsed = JSON.parse(text);
      } catch {
        /* resposta não-JSON */
      }
      if (r.ok) return { ok: true, data: parsed?.data ?? parsed };
      const error = String(parsed?.error || parsed?.message || text).slice(0, 300);
      /* 4xx nunca retenta (erros de estado são tratados pelos chamadores) */
      if (r.status < 500) return { ok: false, error, status: r.status };
      if (attempt < 2) {
        await sleep(200 * Math.pow(3, attempt));
        continue;
      }
      return { ok: false, error, status: r.status };
    } catch (e: any) {
      if (attempt < 2) {
        await sleep(200 * Math.pow(3, attempt));
        continue;
      }
      return { ok: false, error: 'Evolution: ' + String(e?.message || e).slice(0, 200) };
    } finally {
      clearTimeout(tm);
    }
  }
  return { ok: false, error: 'inalcançável' };
}

export const evo = {
  /* apikey GLOBAL */
  create: (name: string, token: string) => evoFetch('/instance/create', { method: 'POST', body: { name, token } }),
  all: () => evoFetch('/instance/all'),
  remove: (instanceId: string) => evoFetch(`/instance/delete/${instanceId}`, { method: 'DELETE' }),
  /* token da instância.
     immediate:true — no Evolution GO, immediate:false NÃO inicia a sessão de
     QR (e pode derrubar uma sessão ativa, gastando o orçamento de 5 QRs). */
  connect: (token: string) =>
    evoFetch('/instance/connect', { method: 'POST', token, body: { immediate: true, subscribe: ['ALL'] } }),
  qr: (token: string) => evoFetch('/instance/qr', { token }), // data.Qrcode (data URL), data.Code
  status: (token: string) => evoFetch('/instance/status', { token }), // data.Connected, data.LoggedIn
  logout: (token: string) => evoFetch('/instance/logout', { method: 'DELETE', token }),
  sendText: (token: string, number: string, text: string) =>
    evoFetch('/send/text', { method: 'POST', token, body: { number, text } }),
};

/* erros 400 que são ESTADO, não falha */
export const isLoggedInError = (r: EvoResult) => !r.ok && /already logged in/i.test(r.error);
export const isNoQrError = (r: EvoResult) => !r.ok && /no qr code available/i.test(r.error);
export const isDisconnectedOk = (r: EvoResult) =>
  !r.ok && /(client disconnected|not connected|already disconnected)/i.test(r.error);

/* recuperação de sessão travada: logout → pausa → connect */
export async function revive(token: string): Promise<EvoResult> {
  const lo = await evo.logout(token);
  if (!lo.ok && !isDisconnectedOk(lo)) return lo;
  await sleep(800);
  return evo.connect(token);
}
