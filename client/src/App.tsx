import { useCallback, useEffect, useState } from 'react';
import { api, type ServerState, type User } from './api';
import { AuthPage } from './auth/AuthPage';
import { ResetPage } from './auth/ResetPage';
import { AgendaApp } from './agenda/AgendaApp';
import { IconSprite } from './agenda/Icons';
import { BrandWordmark, LogoMark } from './brand/Logo';

type Phase = 'loading' | 'auth' | 'app';

export default function App() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [user, setUser] = useState<User | null>(null);
  const [initial, setInitial] = useState<ServerState | null>(null);
  /* rota mínima: /reset?token=... renderiza a criação de nova senha */
  const [resetToken, setResetToken] = useState<string | null>(() =>
    location.pathname === '/reset' ? (new URLSearchParams(location.search).get('token') ?? '') : null,
  );

  const enter = useCallback(async (u: User) => {
    const st = await api.getState();
    setUser(u);
    setInitial(st);
    setPhase('app');
  }, []);

  useEffect(() => {
    if (resetToken !== null) return; // a ResetPage manda; não disputar fase
    api
      .me()
      .then((u) => (u ? enter(u) : setPhase('auth')))
      .catch(() => setPhase('auth'));
  }, [enter, resetToken]);

  /* fora do app (splash/login/reset) o tema é SEMPRE dark; ao entrar, o
     AgendaApp restaura a preferência salva do usuário */
  useEffect(() => {
    if (phase !== 'app' || resetToken !== null) document.documentElement.dataset.theme = 'dark';
  }, [phase, resetToken]);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      location.reload();
    }
  }, []);

  if (resetToken !== null) {
    return (
      <>
        <IconSprite />
        <ResetPage
          token={resetToken}
          onDone={async (u) => {
            history.replaceState(null, '', '/');
            setResetToken(null);
            await enter(u);
          }}
          onCancel={() => {
            history.replaceState(null, '', '/');
            setResetToken(null);
            setPhase('auth');
          }}
        />
      </>
    );
  }

  return (
    <>
      <IconSprite />
      {phase === 'loading' && (
        <div className="splash">
          <LogoMark size={44} tone="gradient" title="AgendaMestre" />
          <BrandWordmark className="splash-name" />
        </div>
      )}
      {phase === 'auth' && <AuthPage onAuth={enter} />}
      {phase === 'app' && user && initial && <AgendaApp user={user} initial={initial} onLogout={logout} />}
    </>
  );
}
