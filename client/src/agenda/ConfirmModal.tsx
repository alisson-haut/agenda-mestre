/* Modal de confirmação reutilizável — ações destrutivas param aqui antes de
   acontecer. `askPassword` transforma a confirmação em re-auth da conta
   (ex.: "Apagar tudo"). Erro do onConfirm (senha errada, falha de rede)
   aparece INLINE e o modal continua aberto; sucesso fecha sozinho.
   Fica acima dos demais modais (.overlay.confirm, z-index 450). */

import { useEffect, useRef, useState } from 'react';

export interface ConfirmCfg {
  title: string;
  msg: string;
  confirmLabel: string;
  danger?: boolean;
  askPassword?: boolean;
  hint?: string;
  onConfirm(password?: string): void | Promise<void>;
}

interface Props {
  open: boolean;
  session: number;
  cfg: ConfirmCfg | null;
  onClose(): void;
}

export function ConfirmModal(p: Props) {
  const [pass, setPass] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const passRef = useRef<HTMLInputElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setPass('');
    setErr(null);
    setBusy(false);
  }, [p.session]);

  useEffect(() => {
    if (!p.open) return;
    const id = window.setTimeout(() => {
      (p.cfg?.askPassword ? passRef.current : okRef.current)?.focus();
    }, 90);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.session, p.open]);

  async function confirmar() {
    const cfg = p.cfg;
    if (!cfg || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await cfg.onConfirm(cfg.askPassword ? pass : undefined);
      p.onClose();
    } catch (e: any) {
      setErr(e?.message || 'Algo deu errado. Tente de novo.');
    } finally {
      setBusy(false);
    }
  }

  const cfg = p.cfg;
  return (
    <div
      id="confirmDlg"
      className={`overlay confirm ${p.open ? 'open' : ''}`}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="cfHead"
      onClick={(e) => {
        if (busy) return;
        const el = e.target as HTMLElement;
        if (el === e.currentTarget || el.closest('[data-close]')) p.onClose();
      }}
    >
      <div className="dlg narrow">
        <div className="dlg-head">
          <div className="dlg-title" id="cfHead">{cfg?.title || 'Confirmar'}</div>
          <button className="iconbtn" data-close aria-label="Fechar"><svg><use href="#i-close" /></svg></button>
        </div>
        <div className="dlg-body">
          <p style={{ fontSize: 14.5, lineHeight: 1.6, color: 'var(--ink-2)' }}>{cfg?.msg}</p>
          {cfg?.askPassword && (
            <div className="field">
              <label className="label" htmlFor="cfPass">Senha da conta</label>
              <input
                className="inp" id="cfPass" ref={passRef} type="password"
                autoComplete="current-password" value={pass}
                onChange={(e) => setPass(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void confirmar(); } }}
              />
              {cfg.hint && <span className="cf-hint">{cfg.hint}</span>}
            </div>
          )}
          {err && <div className="auth-err" role="alert">{err}</div>}
        </div>
        <div className="dlg-foot">
          <div className="spacer" />
          <button className="btn btn-ghost" data-close disabled={busy}>Cancelar</button>
          <button
            id="cfOk"
            ref={okRef}
            className={`btn ${cfg?.danger ? 'btn-danger-solid' : 'btn-primary'}`}
            disabled={busy || (cfg?.askPassword && !pass)}
            onClick={() => void confirmar()}
          >
            {busy ? 'Um instante...' : cfg?.confirmLabel || 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  );
}
