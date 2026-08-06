/* Modal de alerta de lembrete — overlay próprio acima de tudo, estilizado
   pela prioridade da tarefa, com som e ações rápidas. */
import { useEffect, useRef, useState } from 'react';
import type { ActiveAlert } from './useAlerts';
import type { Cat } from './types';
import { taskCats } from './types';
import { dateLabelShort, catOf } from './logic';
import { CatIcon } from './Views';
import { sound } from './sound';

function remindTag(remind: number | null): string {
  if (remind == null || remind === 0) return 'na hora';
  if (remind < 60) return `${remind} min antes`;
  if (remind % 1440 === 0) return `${remind / 1440} dia${remind > 1440 ? 's' : ''} antes`;
  if (remind % 60 === 0) return `${remind / 60} h antes`;
  return `${Math.floor(remind / 60)} h ${remind % 60} min antes`;
}

interface Props {
  alert: ActiveAlert | null;
  queueCount: number;
  cats: Cat[];
  soundEnabled: boolean;
  onAck(): void;
  onSnooze(mins: number): void;
  onEdit(): void;
}

export function AlertModal(p: Props) {
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const key = p.alert?.key;

  useEffect(() => {
    setSnoozeOpen(false);
  }, [key]);

  useEffect(() => {
    if (!key) return;
    const id = window.setTimeout(() => primaryRef.current?.focus(), 90);
    return () => window.clearTimeout(id);
  }, [key]);

  /* som conforme a prioridade; 'alta' repete até o cleanup (troca/fechamento) */
  const prio = p.alert?.t.prio;
  useEffect(() => {
    if (!key || !p.soundEnabled || !prio) return;
    return sound.play(prio);
  }, [key, p.soundEnabled, prio]);

  if (!p.alert) return null;
  const { t, dk } = p.alert;
  const pcats = taskCats(t).map((id) => catOf(p.cats, id));
  const hoje = dateLabelShort(dk) === 'hoje';

  return (
    <div className="alert-overlay" role="presentation">
      <div
        className="alert-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="alertTitle"
        data-p={t.prio}
        onKeyDown={(e) => {
          if (e.key !== 'Tab') return;
          const f = (e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('button');
          if (!f.length) return;
          const first = f[0];
          const last = f[f.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }}
      >
        <div className="alert-tag">Lembrete · {remindTag(t.remind)}</div>
        <div className="alert-time">
          {!hoje && <span className="alert-date">{dateLabelShort(dk)} · </span>}
          {t.time}
        </div>
        <h2 className="alert-title" id="alertTitle">{t.title}</h2>
        {pcats.length > 0 && (
          <div className="alert-cats">
            {pcats.map((c, i) => (
              <span key={c.id + i} className="alert-cat">
                <CatIcon cat={c} />
                {c.name}
              </span>
            ))}
          </div>
        )}
        {t.notes && <p className="alert-notes">{t.notes}</p>}
        {p.queueCount > 0 && (
          <div className="alert-queue">+{p.queueCount} lembrete{p.queueCount > 1 ? 's' : ''} na fila</div>
        )}
        <div className="alert-actions">
          <button className="btn btn-primary" ref={primaryRef} onClick={p.onAck}>
            Vou iniciar
          </button>
          <button className="btn" onClick={() => setSnoozeOpen((o) => !o)} aria-expanded={snoozeOpen}>
            Prorrogar
          </button>
          <button className="btn btn-ghost" onClick={p.onEdit}>
            Mudar data
          </button>
        </div>
        {snoozeOpen && (
          <div className="snooze-menu" role="group" aria-label="Prorrogar por quanto tempo?">
            {[10, 30, 60].map((m) => (
              <button key={m} className="chip" onClick={() => p.onSnooze(m)}>
                +{m === 60 ? '1 h' : `${m} min`}
              </button>
            ))}
          </div>
        )}
        <button className="alert-cancel" onClick={p.onAck}>
          Cancelar este lembrete
        </button>
      </div>
    </div>
  );
}
