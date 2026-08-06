import { useEffect, useRef, useState } from 'react';
import { api, type NotifySettings, type User, type WhatsStatus } from '../api';
import { sound } from './sound';
import { WhatsAppModal } from './WhatsAppModal';
import { CropEditor, type CropHandle } from './CropEditor';

interface Props {
  open: boolean;
  session: number;
  profile: User;
  weekStart: 0 | 1;
  soundEnabled: boolean;
  onWeekStart(ws: 0 | 1): void;
  onSoundEnabled(v: boolean): void;
  onProfile(u: User): void;
  onClose(): void;
  onMsg(m: string): void;
  onConfirm(msg: string, fn: () => void, label: string): void;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function ConfigModal(p: Props) {
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState<string | null>(null);
  const avatarRef = useRef<CropHandle>(null);
  const [savingName, setSavingName] = useState(false);
  const [cur, setCur] = useState('');
  const [nova, setNova] = useState('');
  const [nova2, setNova2] = useState('');
  const [passErr, setPassErr] = useState<string | null>(null);
  const [savingPass, setSavingPass] = useState(false);

  /* notificações */
  const [notif, setNotif] = useState<NotifySettings | null>(null);
  const [notifErr, setNotifErr] = useState(false);
  const [emails, setEmails] = useState<string[]>([]);
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [waEnabled, setWaEnabled] = useState(false);
  const [waNumber, setWaNumber] = useState('');
  const [savingNotif, setSavingNotif] = useState(false);
  const [testing, setTesting] = useState<'' | 'email' | 'whatsapp'>('');
  const [waStatus, setWaStatus] = useState<WhatsStatus | null>(null);
  const [waModal, setWaModal] = useState({ open: false, session: 0 });
  const waLinkedRef = useRef(false);

  useEffect(() => {
    setName(p.profile.name || '');
    setAvatar(p.profile.avatar || null);
    setCur('');
    setNova('');
    setNova2('');
    setPassErr(null);
    /* carrega as configurações de notificação (degrada graciosamente) */
    setNotif(null);
    setNotifErr(false);
    setWaStatus(null);
    if (p.open) {
      api
        .getNotifySettings()
        .then((s) => {
          setNotif(s);
          setEmails(s.emails);
          setEmailEnabled(s.emailEnabled);
          setWaEnabled(s.whatsappEnabled);
          setWaNumber(s.whatsappNumber);
          waLinkedRef.current = s.waInstance;
        })
        .catch(() => setNotifErr(true));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.session]);

  /* status do remetente WhatsApp — polling 5s enquanto o modal está aberto */
  useEffect(() => {
    if (!p.open || !notif?.providers.whatsapp) return;
    let alive = true;
    const load = () =>
      api
        .whatsappStatus()
        .then((s) => {
          if (alive) setWaStatus(s);
        })
        .catch(() => {});
    void load();
    const iv = window.setInterval(load, 5000);
    return () => {
      alive = false;
      window.clearInterval(iv);
    };
  }, [p.open, p.session, notif?.providers.whatsapp, waModal.session]);

  async function salvarPerfil() {
    if (savingName) return;
    setSavingName(true);
    try {
      const u = await api.updateProfile(name.trim(), avatarRef.current?.result() ?? avatar);
      p.onProfile(u);
      setAvatar(u.avatar || null);
      p.onMsg('Perfil atualizado');
    } catch (e: any) {
      p.onMsg(e?.message || 'Não foi possível salvar o perfil.');
    } finally {
      setSavingName(false);
    }
  }

  async function salvarNotif() {
    if (savingNotif) return;
    const limpos = emails.map((e) => e.trim().toLowerCase()).filter((e) => e && EMAIL_RE.test(e));
    if (emailEnabled && !limpos.length) {
      p.onMsg('Adicione ao menos um e-mail válido para ativar o canal.');
      return;
    }
    if (waEnabled && waNumber.length < 10) {
      p.onMsg('Número de WhatsApp inválido — use DDI+DDD+número (ex.: 5541999999999).');
      return;
    }
    setSavingNotif(true);
    try {
      const s = await api.putNotifySettings({
        emails: limpos,
        whatsappNumber: waNumber,
        emailEnabled,
        whatsappEnabled: waEnabled,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      setNotif(s);
      setEmails(s.emails);
      p.onMsg('Notificações salvas');
    } catch (e: any) {
      p.onMsg(e?.message || 'Não foi possível salvar as notificações.');
    } finally {
      setSavingNotif(false);
    }
  }

  async function testar(ch: 'email' | 'whatsapp') {
    if (testing) return;
    setTesting(ch);
    try {
      await api.notifyTest(ch);
      p.onMsg(ch === 'email' ? 'E-mail de teste enviado!' : 'Mensagem de teste enviada!');
    } catch (e: any) {
      p.onMsg(e?.message || 'O teste falhou.');
    } finally {
      setTesting('');
    }
  }

  function desconectarWa() {
    p.onConfirm(
      'Desconectar o WhatsApp remetente? Os lembretes por WhatsApp param de sair.',
      () => {
        api
          .whatsappDisconnect()
          .then(() => {
            setWaStatus({ linked: false, connected: false, loggedIn: false });
            setWaEnabled(false);
            p.onMsg('WhatsApp desconectado');
          })
          .catch((e: any) => p.onMsg(e?.message || 'Falha ao desconectar.'));
      },
      'Desconectar',
    );
  }

  async function trocarSenha() {
    if (savingPass) return;
    setPassErr(null);
    if (nova.length < 8) {
      setPassErr('A nova senha precisa de pelo menos 8 caracteres.');
      return;
    }
    if (nova !== nova2) {
      setPassErr('A confirmação não bate com a nova senha.');
      return;
    }
    setSavingPass(true);
    try {
      await api.changePassword(cur, nova);
      setCur('');
      setNova('');
      setNova2('');
      p.onMsg('Senha alterada — as outras sessões foram desconectadas');
    } catch (e: any) {
      setPassErr(e?.message || 'Não foi possível alterar a senha.');
    } finally {
      setSavingPass(false);
    }
  }

  const waConectado = !!waStatus?.loggedIn;

  return (
    <>
      <div
        className={`overlay ${p.open ? 'open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cfgHead"
        onClick={(e) => {
          const el = e.target as HTMLElement;
          if (el === e.currentTarget || el.closest('[data-close]')) p.onClose();
        }}
      >
        <div className="dlg narrow">
          <div className="dlg-head">
            <div className="dlg-title" id="cfgHead">Configurações</div>
            <button className="iconbtn" data-close aria-label="Fechar"><svg><use href="#i-close" /></svg></button>
          </div>
          <div className="dlg-body">
            <div className="cfg-sec">
              <div className="cfg-h">Perfil</div>
              <div className="field">
                <span className="label">Foto de perfil</span>
                <CropEditor
                  ref={avatarRef}
                  value={avatar}
                  session={p.session}
                  round
                  exportSize={128}
                  accentColor="var(--brand)"
                  placeholder={<span className="avatar-ph">{(p.profile.name || p.profile.email).charAt(0).toUpperCase()}</span>}
                  hint="Sem foto, o avatar usa a inicial do seu nome."
                  onClear={() => setAvatar(null)}
                  onInvalid={p.onMsg}
                />
              </div>
              <div className="field">
                <label className="label" htmlFor="cfgName">Nome</label>
                <input className="inp" id="cfgName" value={name} autoComplete="name"
                  placeholder="Como devemos te chamar?" onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="field">
                <span className="label">E-mail</span>
                <input className="inp" value={p.profile.email} disabled />
              </div>
              <div>
                <button className="btn" onClick={salvarPerfil} disabled={savingName}>
                  {savingName ? 'Salvando...' : 'Salvar perfil'}
                </button>
              </div>
            </div>

            <div className="cfg-sec">
              <div className="cfg-h">Preferências</div>
              <div className="field">
                <label className="label" htmlFor="cfgWeek">Início da semana</label>
                <select className="sel" id="cfgWeek" value={p.weekStart}
                  onChange={(e) => p.onWeekStart(Number(e.target.value) as 0 | 1)}>
                  <option value={0}>Domingo</option>
                  <option value={1}>Segunda-feira</option>
                </select>
              </div>
            </div>

            <div className="cfg-sec">
              <div className="cfg-h">Notificações</div>

              <div className="notif-row">
                <button id="cfgSound" className="switch" role="switch" aria-checked={p.soundEnabled}
                  onClick={() => p.onSoundEnabled(!p.soundEnabled)}>
                  <i />
                </button>
                <span className="notif-lab">Som dos alertas na tela</span>
                <button className="btn btn-ghost btn-sm" onClick={() => { sound.test(); p.onMsg('Som liberado neste aparelho 🔔'); }}>
                  Testar som
                </button>
              </div>

              {notifErr && (
                <div className="iconedit-hint">
                  Não consegui carregar as configurações de e-mail/WhatsApp — tente salvar mesmo assim ou reabra.
                </div>
              )}

              <div className="notif-row">
                <button className="switch" role="switch" aria-checked={emailEnabled}
                  onClick={() => setEmailEnabled((v) => !v)}>
                  <i />
                </button>
                <span className="notif-lab">Lembretes por e-mail</span>
              </div>
              {notif && !notif.providers.email && (
                <div className="iconedit-hint">Servidor sem RESEND_API_KEY — o canal fica inativo até configurar.</div>
              )}
              {emailEnabled && (
                <div className="notif-mails">
                  {emails.map((e, i) => (
                    <div key={i} className="notif-mail-row">
                      <input className="inp" type="email" value={e} placeholder="voce@exemplo.com"
                        onChange={(ev) => setEmails((arr) => arr.map((x, j) => (j === i ? ev.target.value : x)))} />
                      <button className="st-del" aria-label="Remover e-mail"
                        onClick={() => setEmails((arr) => arr.filter((_, j) => j !== i))}>
                        <svg><use href="#i-close" /></svg>
                      </button>
                    </div>
                  ))}
                  {emails.length < 3 && (
                    <button className="st-add" onClick={() => setEmails((arr) => [...arr, ''])}>
                      <svg style={{ width: 16, height: 16 }}><use href="#i-plus" /></svg> Adicionar e-mail
                    </button>
                  )}
                  <button className="btn btn-ghost btn-sm" onClick={() => testar('email')} disabled={testing !== ''}>
                    {testing === 'email' ? 'Enviando…' : 'Enviar e-mail de teste'}
                  </button>
                </div>
              )}

              <div className="notif-row">
                <button className="switch" role="switch" aria-checked={waEnabled}
                  onClick={() => setWaEnabled((v) => !v)}>
                  <i />
                </button>
                <span className="notif-lab">Lembretes por WhatsApp</span>
              </div>
              {notif && !notif.providers.whatsapp && (
                <div className="iconedit-hint">Servidor sem EVOLUTION_BASE_URL/EVOLUTION_API_KEY — o canal fica inativo até configurar.</div>
              )}
              {waEnabled && (
                <div className="notif-mails">
                  <div className="field">
                    <label className="label" htmlFor="cfgWaNum">Número que recebe (DDI+DDD+número)</label>
                    <input className="inp" id="cfgWaNum" inputMode="numeric" placeholder="5541999999999"
                      value={waNumber} maxLength={15}
                      onChange={(e) => setWaNumber(e.target.value.replace(/\D/g, ''))} />
                  </div>
                  <div className="wa-row">
                    <span className={`wa-badge ${waConectado ? 'on' : ''}`}>
                      <i />{waConectado ? 'Remetente conectado' : 'Remetente desconectado'}
                    </span>
                    {waConectado ? (
                      <>
                        <button className="btn btn-ghost btn-sm" onClick={() => testar('whatsapp')} disabled={testing !== ''}>
                          {testing === 'whatsapp' ? 'Enviando…' : 'Enviar teste'}
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={desconectarWa}>Desconectar</button>
                      </>
                    ) : (
                      <button className="btn btn-sm" onClick={() => setWaModal((s) => ({ open: true, session: s.session + 1 }))}>
                        Conectar por QR code
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div>
                <button className="btn btn-primary" onClick={salvarNotif} disabled={savingNotif}>
                  {savingNotif ? 'Salvando...' : 'Salvar notificações'}
                </button>
              </div>
            </div>

            <div className="cfg-sec">
              <div className="cfg-h">Trocar senha</div>
              <div className="field">
                <label className="label" htmlFor="cfgCur">Senha atual</label>
                <input className="inp" id="cfgCur" type="password" value={cur}
                  autoComplete="current-password" onChange={(e) => setCur(e.target.value)} />
              </div>
              <div className="field">
                <label className="label" htmlFor="cfgNew">Nova senha</label>
                <input className="inp" id="cfgNew" type="password" value={nova} minLength={8}
                  autoComplete="new-password" placeholder="Mínimo de 8 caracteres"
                  onChange={(e) => setNova(e.target.value)} />
              </div>
              <div className="field">
                <label className="label" htmlFor="cfgNew2">Confirmar nova senha</label>
                <input className="inp" id="cfgNew2" type="password" value={nova2}
                  autoComplete="new-password" onChange={(e) => setNova2(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') trocarSenha(); }} />
              </div>
              {passErr && <div className="auth-err" role="alert">{passErr}</div>}
              <div>
                <button className="btn btn-primary" onClick={trocarSenha} disabled={savingPass}>
                  {savingPass ? 'Alterando...' : 'Alterar senha'}
                </button>
              </div>
            </div>
          </div>
          <div className="dlg-foot">
            <div className="spacer" />
            <button className="btn btn-ghost" data-close>Fechar</button>
          </div>
        </div>
      </div>

      <WhatsAppModal
        open={waModal.open}
        session={waModal.session}
        onClose={() => setWaModal((s) => ({ ...s, open: false }))}
        onConnected={() => {
          setWaStatus({ linked: true, connected: true, loggedIn: true });
          p.onMsg('WhatsApp conectado! Salve as notificações para ativar o canal.');
        }}
      />
    </>
  );
}
