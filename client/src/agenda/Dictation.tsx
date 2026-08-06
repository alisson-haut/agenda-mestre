import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { pad } from './dates';

/* Ditado por voz: grava com MediaRecorder (com pausa), mostra tempo + barras de
   pico (WebAudio AnalyserNode) e transcreve via Groq Whisper no servidor.
   Controles durante a gravação: pausar/retomar · enviar · descartar. */

type Phase = 'idle' | 'rec' | 'busy';
const BARS = 14;

const fmt = (s: number) => `${Math.floor(s / 60)}:${pad(s % 60)}`;

export function Dictation({
  onText,
  onError,
  label = 'Ditar com a voz',
  maxSecs = 120,
}: {
  onText(t: string): void;
  onError(msg: string): void;
  label?: string;
  maxSecs?: number;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [secs, setSecs] = useState(0);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const barsRef = useRef<HTMLSpanElement>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef(0);
  const timerRef = useRef<number | undefined>(undefined);
  const cancelledRef = useRef(false);
  const mimeRef = useRef('audio/webm');

  const teardownMedia = () => {
    cancelAnimationFrame(rafRef.current);
    window.clearInterval(timerRef.current);
    ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  /* limpeza se o modal fechar no meio da gravação */
  useEffect(
    () => () => {
      cancelledRef.current = true;
      try {
        if (recRef.current && recRef.current.state !== 'inactive') recRef.current.stop();
      } catch {
        /* já parado */
      }
      teardownMedia();
    },
    [],
  );

  async function start() {
    if (phase !== 'idle') return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      onError('Este navegador não suporta gravação de áudio.');
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      onError('Não consegui acessar o microfone. Verifique a permissão do navegador.');
      return;
    }
    streamRef.current = stream;
    cancelledRef.current = false;
    pausedRef.current = false;
    setPaused(false);
    chunksRef.current = [];
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : MediaRecorder.isTypeSupported('audio/mp4')
          ? 'audio/mp4'
          : '';
    mimeRef.current = (mime || 'audio/webm').split(';')[0];
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    recRef.current = rec;
    rec.ondataavailable = (e) => {
      if (e.data.size) chunksRef.current.push(e.data);
    };
    rec.onstop = () => finish();
    rec.start(250);

    /* barras de pico — curva de potência para dar vida até em som baixo */
    try {
      const ctx = new AudioContext();
      ctxRef.current = ctx;
      const an = ctx.createAnalyser();
      an.fftSize = 256;
      ctx.createMediaStreamSource(stream).connect(an);
      const data = new Uint8Array(an.frequencyBinCount);
      const levels: number[] = Array(BARS).fill(0);
      const draw = () => {
        if (!pausedRef.current) {
          an.getByteTimeDomainData(data);
          let peak = 0;
          for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i] - 128) / 128);
          levels.push(peak);
          levels.shift();
          const bars = barsRef.current?.children;
          if (bars)
            for (let i = 0; i < bars.length; i++)
              (bars[i] as HTMLElement).style.height =
                `${Math.max(8, Math.min(100, Math.pow(levels[i], 0.5) * 145))}%`;
        }
        rafRef.current = requestAnimationFrame(draw);
      };
      rafRef.current = requestAnimationFrame(draw);
    } catch {
      /* sem visualização, gravação segue normal */
    }

    setSecs(0);
    timerRef.current = window.setInterval(() => {
      if (pausedRef.current) return;
      setSecs((s) => {
        if (s + 1 >= maxSecs) send();
        return s + 1;
      });
    }, 1000);
    setPhase('rec');
  }

  function togglePause() {
    const rec = recRef.current;
    if (!rec) return;
    if (rec.state === 'recording') {
      rec.pause();
      pausedRef.current = true;
      setPaused(true);
    } else if (rec.state === 'paused') {
      rec.resume();
      pausedRef.current = false;
      setPaused(false);
    }
  }

  /* enviar: para a gravação e transcreve */
  function send() {
    try {
      if (recRef.current && recRef.current.state !== 'inactive') recRef.current.stop();
    } catch {
      /* já parado */
    }
  }

  /* lixeira: descarta o áudio sem transcrever */
  function discard() {
    cancelledRef.current = true;
    if (recRef.current && recRef.current.state !== 'inactive') send();
    else {
      teardownMedia();
      setPhase('idle');
    }
  }

  async function finish() {
    teardownMedia();
    const blob = new Blob(chunksRef.current, { type: mimeRef.current });
    chunksRef.current = [];
    recRef.current = null;
    if (cancelledRef.current) {
      setPhase('idle');
      return;
    }
    if (blob.size < 800) {
      setPhase('idle');
      onError('Gravação curta demais — tente de novo.');
      return;
    }
    setPhase('busy');
    try {
      const text = await api.transcribe(blob);
      if (text) onText(text);
      else onError('Não entendi o áudio. Fale mais perto do microfone.');
    } catch (e: any) {
      onError(e?.message || 'A transcrição falhou.');
    } finally {
      setPhase('idle');
    }
  }

  if (phase === 'idle')
    return (
      <button type="button" className="dict-btn" onClick={start} aria-label={label} title={label}>
        <svg><use href="#i-mic" /></svg>
      </button>
    );

  if (phase === 'rec')
    return (
      <span className="dict-rec" role="status" aria-label={paused ? 'Gravação pausada' : 'Gravando áudio'}>
        <i className={`dict-dot ${paused ? 'paused' : ''}`} />
        <span className="dict-bars" ref={barsRef} aria-hidden="true">
          {Array.from({ length: BARS }, (_, i) => (
            <i key={i} />
          ))}
        </span>
        <span className="dict-time">{fmt(secs)}<em className="dict-max">/{fmt(maxSecs)}</em></span>
        <button type="button" className="dict-mini" onClick={togglePause}
          aria-label={paused ? 'Retomar gravação' : 'Pausar gravação'} title={paused ? 'Retomar' : 'Pausar'}>
          <svg><use href={paused ? '#i-play' : '#i-pause'} /></svg>
        </button>
        <button type="button" className="dict-send" onClick={send} aria-label="Enviar e transcrever" title="Enviar e transcrever">
          <svg><use href="#i-send" /></svg>
        </button>
        <button type="button" className="dict-mini danger" onClick={discard} aria-label="Descartar gravação" title="Descartar">
          <svg><use href="#i-trash" /></svg>
        </button>
      </span>
    );

  return (
    <span className="dict-rec dict-busy" role="status">
      <i className="dict-spin" />
      <span className="dict-time" style={{ minWidth: 0 }}>Transcrevendo…</span>
    </span>
  );
}
