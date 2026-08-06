import { useEffect, useState, type FormEvent } from 'react';
import { api, type User } from '../api';
import { BrandWordmark, LogoMark } from '../brand/Logo';

type Mode = 'login' | 'register' | 'forgot';

export function AuthPage({ onAuth }: { onAuth: (u: User) => Promise<void> | void }) {
  const [mode, setMode] = useState<Mode>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [forgotOk, setForgotOk] = useState<string | null>(null);
  const [google, setGoogle] = useState(false);
  const [googleErr] = useState(() => new URLSearchParams(location.search).get('google') === 'erro');

  useEffect(() => {
    api.getProviders().then((p) => setGoogle(p.google)).catch(() => {});
  }, []);

  function trocar(m: Mode) {
    setMode(m);
    setErr(null);
    setForgotOk(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setErr(null);
    setBusy(true);
    try {
      if (mode === 'forgot') {
        const r = await api.forgot(email);
        setForgotOk(r.message);
      } else {
        const u =
          mode === 'login'
            ? await api.login(email, password)
            : await api.register(email, password, name);
        await onAuth(u);
        return;
      }
    } catch (e: any) {
      setErr(e?.message || 'Algo deu errado. Tente de novo.');
    }
    setBusy(false);
  }

  return (
    <div className="authwrap">
      <div className="auth-hero">
        <LogoMark size={52} tone="gradient" title="AgendaMestre" />
        <BrandWordmark className="auth-name" />
      </div>
      <div className="authcard">
        <div>
          <h1 className="auth-title">
            {mode === 'login' ? 'Bem-vindo de volta' : mode === 'register' ? 'Crie sua conta' : 'Recuperar acesso'}
          </h1>
          <p className="auth-sub">
            {mode === 'login'
              ? 'Entre para abrir sua agenda.'
              : mode === 'register'
                ? 'Leva menos de um minuto — só e-mail e senha.'
                : 'Informe o e-mail da conta e enviaremos um link para criar uma senha nova.'}
          </p>
        </div>
        {mode !== 'forgot' && (
          <div className="auth-tabs" role="tablist">
            <button role="tab" aria-pressed={mode === 'login'} onClick={() => trocar('login')}>
              Entrar
            </button>
            <button role="tab" aria-pressed={mode === 'register'} onClick={() => trocar('register')}>
              Criar conta
            </button>
          </div>
        )}
        {mode === 'forgot' && forgotOk ? (
          <div className="auth-ok" role="status">
            <b>Confira sua caixa de entrada</b>
            {forgotOk}
          </div>
        ) : (
          <form className="auth-form" onSubmit={submit}>
            {mode === 'register' && (
              <div className="field">
                <label className="label" htmlFor="aName">Nome (opcional)</label>
                <input className="inp" id="aName" value={name} onChange={(e) => setName(e.target.value)}
                  placeholder="Como devemos te chamar?" autoComplete="name" />
              </div>
            )}
            <div className="field">
              <label className="label" htmlFor={mode === 'forgot' ? 'fEmail' : 'aEmail'}>E-mail</label>
              <input className="inp" id={mode === 'forgot' ? 'fEmail' : 'aEmail'} type="email" required
                value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@exemplo.com"
                autoComplete="email" inputMode="email" />
            </div>
            {mode !== 'forgot' && (
              <div className="field">
                <label className="label" htmlFor="aPass">Senha</label>
                <input className="inp" id="aPass" type="password" required minLength={8} value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === 'register' ? 'Mínimo de 8 caracteres' : 'Sua senha'}
                  autoComplete={mode === 'register' ? 'new-password' : 'current-password'} />
                {mode === 'login' && (
                  <button type="button" className="auth-forgot" id="aForgot" onClick={() => trocar('forgot')}>
                    Esqueci minha senha
                  </button>
                )}
              </div>
            )}
            {(err || googleErr) && (
              <div className="auth-err" role="alert">
                {err || 'Não foi possível entrar com o Google. Tente de novo.'}
              </div>
            )}
            <button className="btn btn-primary" type="submit" disabled={busy} style={{ justifyContent: 'center' }}>
              {busy
                ? 'Um instante...'
                : mode === 'login'
                  ? 'Entrar'
                  : mode === 'register'
                    ? 'Criar conta e entrar'
                    : 'Enviar link'}
            </button>
            {mode !== 'forgot' && (
              <>
                <div className="auth-sep"><span>ou</span></div>
                <button
                  type="button"
                  className="btn btn-google"
                  id="aGoogle"
                  disabled={!google}
                  title={google ? undefined : 'Login com Google ainda não habilitado neste servidor'}
                  onClick={() => { if (google) location.href = '/api/auth/google'; }}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.66-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.1 3.57-5.18 3.57-8.81z" />
                    <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.88-3c-1.08.72-2.45 1.15-4.06 1.15-3.13 0-5.78-2.11-6.72-4.96H1.27v3.1A12 12 0 0 0 12 24z" />
                    <path fill="#FBBC05" d="M5.28 14.28a7.2 7.2 0 0 1 0-4.56v-3.1H1.27a12 12 0 0 0 0 10.76l4.01-3.1z" />
                    <path fill="#EA4335" d="M12 4.76c1.76 0 3.34.6 4.59 1.79l3.44-3.44A11.98 11.98 0 0 0 1.27 6.62l4.01 3.1C6.22 6.87 8.87 4.76 12 4.76z" />
                  </svg>
                  Continuar com Google
                </button>
              </>
            )}
          </form>
        )}
        {mode === 'forgot' && (
          <button className="auth-link" onClick={() => trocar('login')}>Voltar para entrar</button>
        )}
        <div className="auth-foot">
          Seus dados ficam na sua conta, protegidos por senha.
        </div>
      </div>
    </div>
  );
}
