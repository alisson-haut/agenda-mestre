/* Som dos alertas — WebAudio puro, sem arquivos de áudio.
   O AudioContext precisa ser liberado por um gesto do usuário: unlock() é
   chamado no primeiro toque na página e no botão "Testar som". Nunca lança. */
import type { Prio } from './types';

let ctx: AudioContext | null = null;

function ensureCtx(): AudioContext | null {
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
    return ctx;
  } catch {
    return null;
  }
}

function beep(c: AudioContext, freq: number, at: number, dur = 0.32, vol = 0.22) {
  try {
    const o = c.createOscillator();
    const g = c.createGain();
    o.connect(g);
    g.connect(c.destination);
    o.type = 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.start(at);
    o.stop(at + dur + 0.05);
  } catch {
    /* áudio bloqueado — silêncio */
  }
}

function pattern(c: AudioContext, prio: Prio) {
  const t = c.currentTime + 0.03;
  if (prio === 'baixa') beep(c, 520, t);
  else if (prio === 'media') {
    beep(c, 520, t);
    beep(c, 660, t + 0.45);
  } else {
    beep(c, 660, t, 0.2);
    beep(c, 660, t + 0.27, 0.2);
    beep(c, 880, t + 0.54, 0.34, 0.26);
  }
}

export const sound = {
  /** libera o AudioContext (chamar num gesto do usuário) */
  unlock(): void {
    ensureCtx();
  },
  /** toca o padrão da prioridade; para 'alta' repete até o stopper ser chamado */
  play(prio: Prio): () => void {
    const c = ensureCtx();
    if (!c) return () => {};
    pattern(c, prio);
    if (prio !== 'alta') return () => {};
    const iv = window.setInterval(() => {
      const cc = ensureCtx();
      if (cc) pattern(cc, 'alta');
    }, 2200);
    return () => window.clearInterval(iv);
  },
  /** botão "Testar som" das Configurações — o clique é o gesto que desbloqueia */
  test(): void {
    const c = ensureCtx();
    if (c) pattern(c, 'media');
  },
};
