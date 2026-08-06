/* Templates das notificações — e-mail (HTML "papel e tinta") e WhatsApp (texto). */

export interface ReminderInfo {
  title: string;
  notes: string;
  prio: 'baixa' | 'media' | 'alta';
  dk: string; // YYYY-MM-DD (data da ocorrência, no fuso do usuário)
  time: string; // HH:MM
  remind: number; // minutos de antecedência
}

const esc = (s: string) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/* identidade da marca nos e-mails (e-mail permanece claro por compatibilidade) */
export const EMAIL_COLORS = {
  bg: '#F2F4F7',
  card: '#FFFFFF',
  line: '#E1E6EB',
  ink: '#0B0F12',
  ink2: '#4A545D',
  ink3: '#8A939B',
  brand: '#0A7F64',
  accent: '#00E09A',
  tile: '#0B0F12',
  chip: '#E9EDF1',
};

const PRIO_LABEL: Record<string, string> = { baixa: 'baixa', media: 'média', alta: 'ALTA' };
const PRIO_COLOR: Record<string, string> = { baixa: '#0A7F64', media: '#9C5F10', alta: '#B23A2A' };

export const appUrl = () => (process.env.APP_URL || 'http://localhost:5192').replace(/\/+$/, '');

export function fmtDk(dk: string): string {
  const [y, m, d] = dk.split('-');
  return `${d}/${m}/${y}`;
}

export function remindLabel(remind: number): string {
  if (remind === 0) return 'agora';
  if (remind < 60) return `em ${remind} min`;
  if (remind % 1440 === 0) return `em ${remind / 1440} dia${remind > 1440 ? 's' : ''}`;
  if (remind % 60 === 0) return `em ${remind / 60} h`;
  return `em ${Math.floor(remind / 60)} h ${remind % 60} min`;
}

export const emailSubject = (r: ReminderInfo) => `Lembrete: ${r.title} — ${r.time}`;

export function emailHtml(r: ReminderInfo): string {
  const C = EMAIL_COLORS;
  const prio = PRIO_LABEL[r.prio] || r.prio;
  const cor = PRIO_COLOR[r.prio] || C.brand;
  const notas = r.notes
    ? `<tr><td style="padding:14px 0 0"><div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:${C.ink3};padding-bottom:4px">Anotações</div>
       <div style="font-size:14px;color:${C.ink2};line-height:1.6;white-space:pre-wrap">${esc(r.notes.slice(0, 600))}</div></td></tr>`
    : '';
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;padding:0;background:${C.bg}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};padding:32px 12px;font-family:-apple-system,'Segoe UI',system-ui,Roboto,sans-serif">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
  <tr><td style="padding:0 4px 14px">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td style="width:28px;height:28px;background:${C.tile};border-radius:9px;text-align:center;line-height:26px;color:${C.accent};font-size:24px;font-weight:700">&middot;</td>
      <td style="padding-left:10px;font-family:'Sora',-apple-system,'Segoe UI',sans-serif;font-size:17px;font-weight:600;color:${C.ink};letter-spacing:-0.2px">AgendaMestre<span style="color:${C.brand}">&middot;</span></td>
    </tr></table>
  </td></tr>
  <tr><td style="background:${C.card};border:1px solid ${C.line};border-top:3px solid ${C.accent};border-radius:16px;padding:26px 26px 22px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:${C.ink3};padding-bottom:8px">
        Lembrete · começa ${esc(remindLabel(r.remind))}
      </td></tr>
      <tr><td style="font-size:22px;font-weight:700;color:${C.ink};letter-spacing:-0.4px;line-height:1.25;padding-bottom:10px">${esc(r.title)}</td></tr>
      <tr><td style="padding-bottom:4px">
        <span style="display:inline-block;font-size:14px;color:${C.ink};background:${C.chip};border-radius:8px;padding:6px 10px;font-family:ui-monospace,Consolas,monospace">${esc(fmtDk(r.dk))} às ${esc(r.time)}</span>
        <span style="display:inline-block;font-size:12px;font-weight:600;color:#FFFFFF;background:${cor};border-radius:8px;padding:7px 10px;margin-left:6px">prioridade ${esc(prio)}</span>
      </td></tr>
      ${notas}
      <tr><td style="padding-top:20px">
        <a href="${esc(appUrl())}" style="display:inline-block;background:${C.brand};color:#FFFFFF;text-decoration:none;font-size:14px;font-weight:600;padding:12px 22px;border-radius:10px">Abrir AgendaMestre</a>
      </td></tr>
    </table>
  </td></tr>
  <tr><td style="padding:14px 6px 0;font-size:12px;color:${C.ink3};line-height:1.6" align="center">
    Você recebeu este lembrete porque ativou notificações por e-mail nas Configurações do AgendaMestre.
  </td></tr>
</table>
</td></tr></table></body></html>`;
}

export function whatsText(r: ReminderInfo): string {
  const prio = PRIO_LABEL[r.prio] || r.prio;
  const linhas = [
    '⏰ *AgendaMestre* — lembrete',
    `*${r.title}*`,
    `${fmtDk(r.dk)} às ${r.time} · prioridade ${prio} · começa ${remindLabel(r.remind)}`,
  ];
  if (r.notes) linhas.push(r.notes.slice(0, 300));
  linhas.push(appUrl());
  return linhas.join('\n');
}
