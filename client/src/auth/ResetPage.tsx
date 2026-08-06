/* Criação de nova senha a partir do link de recuperação (/reset?token=...). */
import { useState, type FormEvent } from 'react';
import { api, type User } from '../api';
import { BrandWordmark, LogoMark } from '../brand/Logo';

function forca(p: string): { nivel: 0 | 1 | 2 | 3; label: string } {
  if (!p) return { nivel: 0, label: '' };
  let score = 0;
  if (p.length >= 8) score++;
  if (p.length >= 12) score++;
  if (/[A-Z]/.test(p) && /[a-z]/.test(p)) score++;
  if (/\d/.test(p)) score++;
  if (/[^A-Za-z0-9]/.test(p)) score++;
  if (score <= 2) return { nivel: 1, label: 'fraca' };
  if (score <= 3) return { nivel: 2, label: 'média' };
  return { nivel: 3, label: 'forte' };
}

export function ResetPage({
  token,
  onDone,
  onCancel,
}: {
  token: string;
  onDone: (u: User) => Promise<void> | void;
  onCancel: () => void;
}) {
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const f = forca(pass);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setErr(null);
    if (pass.length < 8) {
      setErr('A senha precisa de pelo menos 8 caracteres.');
      return;
    }
    if (pass !== pass2) {
      setErr('A confirmação não bate com a nova senha.');
      return;
    }
    setBusy(true);
    try {
      const u = await api.resetPassword(token, pass);
      await onDone(u);
    } catch (e: any) {
      setErr(e?.message || 'Não foi possível redefinir a senha.');
      setBusy(false);
    }
  }

  return (
    <div className="authwrap">
      <div className="auth-hero">
        <LogoMark size={52} tone="gradient" title="AgendaMestre" />
        <BrandWordmark className="auth-name" />
      </div>
      <div className="authcard">
        <div>
          <h1 className="auth-title">Criar nova senha</h1>
          <p className="auth-sub">Escolha uma senha nova para a sua conta.</p>
        </div>
        <form className="auth-form" onSubmit={submit}>
          <div className="field">
            <label className="label" htmlFor="rPass">Nova senha</label>
            <input className="inp" id="rPass" type="password" required minLength={8} value={pass}
              autoComplete="new-password" placeholder="Mínimo de 8 caracteres" autoFocus
              onChange={(e) => setPass(e.target.value)} />
            {pass && (
              <div className="pw-meter" data-nivel={f.nivel} aria-live="polite">
                <i /><i /><i />
                <span>{f.label}</span>
              </div>
            )}
          </div>
          <div className="field">
            <label className="label" htmlFor="rPass2">Confirmar nova senha</label>
            <input className="inp" id="rPass2" type="password" required value={pass2}
              autoComplete="new-password" onChange={(e) => setPass2(e.target.value)} />
          </div>
          {err && <div className="auth-err" role="alert">{err}</div>}
          <button className="btn btn-primary" type="submit" disabled={busy} style={{ justifyContent: 'center' }}>
            {busy ? 'Salvando...' : 'Salvar nova senha'}
          </button>
        </form>
        <button className="auth-link" onClick={onCancel}>Pedir novo link</button>
      </div>
    </div>
  );
}
