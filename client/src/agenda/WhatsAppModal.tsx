/* Conexão do WhatsApp remetente por QR code (Evolution GO, via proxy do
   servidor). Máquina de estados: connecting → waiting → qr → connected,
   com desvios stuck (sem QR após 12s) e error. */
import { useEffect, useState } from 'react';
import { api } from '../api';

type Phase = 'connecting' | 'waiting' | 'qr' | 'connected' | 'stuck' | 'error';

interface Props {
  open: boolean;
  session: number;
  onClose(): void;
  onConnected(): void;
}

export function WhatsAppModal(p: Props) {
  const [phase, setPhase] = useState<Phase>('connecting');
  const [qr, setQr] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!p.open) return;
    let alive = true;
    let pollIv: number | undefined;
    let stuckTm: number | undefined;
    let closeTm: number | undefined;
    let sawQr = false;

    const finishConnected = () => {
      if (!alive) return;
      window.clearInterval(pollIv);
      window.clearTimeout(stuckTm);
      setPhase('connected');
      closeTm = window.setTimeout(() => {
        if (!alive) return;
        p.onConnected();
        p.onClose();
      }, 1200);
    };

    const poll = async () => {
      try {
        const r = await api.whatsappQr();
        if (!alive) return;
        if (r.connected) return finishConnected();
        if (r.qr) {
          sawQr = true;
          window.clearTimeout(stuckTm);
          setQr(r.qr);
          setPhase('qr');
          return;
        }
        setPhase((ph) => (ph === 'qr' ? ph : 'waiting'));
      } catch (e: any) {
        if (!alive) return;
        window.clearInterval(pollIv);
        window.clearTimeout(stuckTm);
        setErr(e?.message || 'Falha de rede.');
        setPhase('error');
      }
    };

    (async () => {
      setPhase('connecting');
      setQr(null);
      setErr('');
      try {
        const st = await api.whatsappConnect();
        if (!alive) return;
        if (st.loggedIn) return finishConnected();
        setPhase('waiting');
        void poll();
        pollIv = window.setInterval(poll, 3000);
        stuckTm = window.setTimeout(() => {
          if (alive && !sawQr) {
            window.clearInterval(pollIv);
            setPhase('stuck');
          }
        }, 12_000);
      } catch (e: any) {
        if (!alive) return;
        setErr(e?.message || 'Falha ao iniciar a conexão.');
        setPhase('error');
      }
    })();

    return () => {
      alive = false;
      window.clearInterval(pollIv);
      window.clearTimeout(stuckTm);
      window.clearTimeout(closeTm);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.open, p.session, attempt]);

  return (
    <div
      className={`overlay ${p.open ? 'open' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="waHead"
      onClick={(e) => {
        const el = e.target as HTMLElement;
        if (el === e.currentTarget || el.closest('[data-close]')) p.onClose();
      }}
    >
      <div className="dlg narrow">
        <div className="dlg-head">
          <div className="dlg-title" id="waHead">Conectar WhatsApp</div>
          <button className="iconbtn" data-close aria-label="Fechar"><svg><use href="#i-close" /></svg></button>
        </div>
        <div className="dlg-body">
          {phase === 'connected' ? (
            <div className="wa-state ok">
              <svg className="wa-check"><use href="#i-check" /></svg>
              <b>WhatsApp conectado!</b>
              <span>Este número agora envia os seus lembretes.</span>
            </div>
          ) : phase === 'qr' && qr ? (
            <>
              <div className="wa-qrbox">
                <img src={qr} alt="QR code para conectar o WhatsApp" />
              </div>
              <div className="wa-hint">
                No celular <b>remetente</b>: WhatsApp → <b>Aparelhos conectados</b> →{' '}
                <b>Conectar aparelho</b> e aponte a câmera para o código. O QR se renova sozinho.
              </div>
            </>
          ) : phase === 'stuck' ? (
            <div className="wa-state">
              <b>A sessão parece travada.</b>
              <span>O servidor não gerou o QR code a tempo.</span>
              <button className="btn" onClick={() => setAttempt((a) => a + 1)}>Reiniciar sessão</button>
            </div>
          ) : phase === 'error' ? (
            <div className="wa-state">
              <div className="auth-err" role="alert">{err}</div>
              <button className="btn" onClick={() => setAttempt((a) => a + 1)}>Tentar de novo</button>
            </div>
          ) : (
            <div className="wa-state">
              <i className="dict-spin" />
              <span>{phase === 'connecting' ? 'Iniciando conexão…' : 'Gerando QR code…'}</span>
            </div>
          )}
        </div>
        <div className="dlg-foot">
          <div className="spacer" />
          <button className="btn btn-ghost" data-close>Fechar</button>
        </div>
      </div>
    </div>
  );
}
