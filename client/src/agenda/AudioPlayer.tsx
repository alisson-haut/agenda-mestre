/* Player de áudio discreto para mídias de nota — play/pause, barra clicável,
   tempo e velocidade 1x→1.5x→2x→3x (playbackRate; o controle NATIVO do
   navegador não expõe 3x — por isso o player próprio). */

import { useEffect, useRef, useState } from 'react';

const RATES = [1, 1.5, 2, 3];

const fmt = (s: number) => {
  if (!isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

export function AudioPlayer({ src }: { src: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);
  const [rate, setRate] = useState(1);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const meta = () => {
      /* quirk do Chrome: webm do MediaRecorder vem com duration Infinity até
         um seek — força o seek pro fim e volta para materializar a duração */
      if (!isFinite(a.duration)) {
        const fix = () => {
          a.removeEventListener('timeupdate', fix);
          a.currentTime = 0;
          setDur(a.duration);
        };
        a.addEventListener('timeupdate', fix);
        a.currentTime = 1e10;
      } else setDur(a.duration);
    };
    const time = () => setT(a.currentTime);
    const fim = () => setPlaying(false);
    a.addEventListener('loadedmetadata', meta);
    a.addEventListener('timeupdate', time);
    a.addEventListener('ended', fim);
    a.addEventListener('pause', fim);
    a.addEventListener('play', () => setPlaying(true));
    return () => {
      a.pause();
    };
  }, [src]);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) void a.play().catch(() => {});
    else a.pause();
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = audioRef.current;
    if (!a || !isFinite(dur) || !dur) return;
    const r = e.currentTarget.getBoundingClientRect();
    a.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * dur;
  };

  const cicloRate = () => {
    const a = audioRef.current;
    const prox = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
    setRate(prox);
    if (a) a.playbackRate = prox;
  };

  return (
    <div className="ap" onClick={(e) => e.stopPropagation()}>
      <audio ref={audioRef} src={src} preload="metadata" />
      <button type="button" className="ap-btn" onClick={toggle}
        aria-label={playing ? 'Pausar' : 'Reproduzir'}>
        <svg><use href={playing ? '#i-pause' : '#i-play'} /></svg>
      </button>
      <div className="ap-bar" onClick={seek} role="slider" aria-label="Posição do áudio"
        aria-valuemin={0} aria-valuemax={Math.round(dur)} aria-valuenow={Math.round(t)}>
        <i style={{ width: dur ? `${(t / dur) * 100}%` : '0%' }} />
      </div>
      <span className="ap-time">{fmt(t)} / {fmt(dur)}</span>
      <button type="button" className="ap-rate" onClick={cicloRate} title="Velocidade de reprodução">
        {rate}x
      </button>
    </div>
  );
}
