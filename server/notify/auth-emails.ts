/* E-mails transacionais de conta (remetente no-reply) — separados dos
   lembretes. Cores centralizadas em EMAIL_COLORS (templates.ts). */
import { appUrl, EMAIL_COLORS as C } from './templates.js';

const esc = (s: string) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const authFrom = () =>
  process.env.RESEND_FROM_AUTH || 'AgendaMestre <no-reply@agendamestre.app.br>';

/* cabeçalho de marca compatível com clientes de e-mail (sem imagens externas) */
export function emailBrandHeader(): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0"><tr>
    <td style="width:28px;height:28px;background:${C.tile};border-radius:9px;text-align:center;line-height:26px;color:${C.accent};font-size:24px;font-weight:700">&middot;</td>
    <td style="padding-left:10px;font-family:'Sora',-apple-system,'Segoe UI',sans-serif;font-size:17px;font-weight:600;color:${C.ink};letter-spacing:-0.2px">AgendaMestre<span style="color:${C.brand}">&middot;</span></td>
  </tr></table>`;
}

export const resetEmailSubject = () => 'Redefinir sua senha — AgendaMestre';

export function resetEmailHtml(name: string, link: string): string {
  const ola = name ? `Olá, ${esc(name)}` : 'Olá';
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;padding:0;background:${C.bg}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};padding:32px 12px;font-family:-apple-system,'Segoe UI',system-ui,Roboto,sans-serif">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
  <tr><td style="padding:0 4px 14px">${emailBrandHeader()}</td></tr>
  <tr><td style="background:${C.card};border:1px solid ${C.line};border-top:3px solid ${C.accent};border-radius:16px;padding:26px 26px 22px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="font-size:19px;font-weight:700;color:${C.ink};padding-bottom:10px">${ola}</td></tr>
      <tr><td style="font-size:14px;color:${C.ink2};line-height:1.6;padding-bottom:18px">
        Recebemos um pedido para redefinir a senha da sua conta. Clique no botão
        abaixo para criar uma senha nova.
      </td></tr>
      <tr><td style="padding-bottom:18px">
        <a href="${esc(link)}" style="display:inline-block;background:${C.brand};color:#FFFFFF;text-decoration:none;font-size:14px;font-weight:600;padding:12px 22px;border-radius:10px">Criar nova senha</a>
      </td></tr>
      <tr><td style="font-size:12px;color:${C.ink3};line-height:1.6;padding-bottom:14px;word-break:break-all">
        Se o botão não funcionar, copie e cole este endereço no navegador:<br>
        <a href="${esc(link)}" style="color:${C.brand}">${esc(link)}</a>
      </td></tr>
      <tr><td style="font-size:12px;color:${C.ink3};line-height:1.6;border-top:1px solid ${C.line};padding-top:14px">
        O link vale por <b>30 minutos</b> e só pode ser usado uma vez.<br>
        Se não foi você que pediu, ignore este e-mail — sua senha continua a mesma.
      </td></tr>
    </table>
  </td></tr>
  <tr><td style="padding:14px 6px 0;font-size:12px;color:${C.ink3};line-height:1.6" align="center">
    E-mail automático do AgendaMestre (${esc(appUrl())}) — não responda.
  </td></tr>
</table>
</td></tr></table></body></html>`;
}
