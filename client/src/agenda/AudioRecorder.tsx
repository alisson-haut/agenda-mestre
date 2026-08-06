/* Gravador de áudio para notas — irmão estrutural do Dictation, mas o blob
   vira MÍDIA da nota (sem transcrever). Começa a gravar assim que monta;
   controles: pausar/retomar · usar · descartar. Fallback: enviar arquivo. */

import { useEffect, useRef, useState } from 'react';
import { pad } from './dates';

const BARS = 14;
const fmt = (s: number) => `${Math.floor(s / 60)}:${pad(s % 60)}`;

interface Props {
  maxSecs?: number;
  onDone(blob: Blob, mime: string): void;
  onError(msg: string): void;
  onClose(): void;
  onPickFile(): void; /* fallback de upload quando não há microfone */
}

export function AudioRecorder({ maxSecs = 600, onDone, onError, onClose, onPickFile }: Props) {
  const [recording, setRecording] = useState(false);
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
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  const teardownMedia = () => {
    cancelAnimationFrame(rafRef.current);
    window.clearInterval(timerRef.current);
    ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  useEffect(() => {
    let vivo = true;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        onError('Este navegador não suporta gravação de áudio.');
        onPickFile();
        onClose();
        return;
      }
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        onError('Não consegui acessar o microfone. Você pode enviar um arquivo de áudio.');
        onClose();
        return;
      }
      if (!vivo) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
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
      rec.onstop = () => {
        teardownMedia();
        const blob = new Blob(chunksRef.current, { type: mimeRef.current });
        chunksRef.current = [];
        recRef.current = null;
        if (!cancelledRef.current && blob.size >= 800) doneRef.current(blob, mimeRef.current);
        else if (!cancelledRef.current) onError('Gravação curta demais — tente de novo.');
        onClose();
      };
      rec.start(250);
      setRecording(true);

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
        /* sem visualização, gravação segue */
      }

      setSecs(0);
      timerRef.current = window.setInterval(() => {
        if (pausedRef.current) return;
        setSecs((s) => {
          if (s + 1 >= maxSecs) usar();
          return s + 1;
        });
      }, 1000);
    })();
    return () => {
      vivo = false;
      cancelledRef.current = true;
      try {
        if (recRef.current && recRef.current.state !== 'inactive') recRef.current.stop();
      } catch {
        /* já parado */
      }
      teardownMedia();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  function usar() {
    try {
      if (recRef.current && recRef.current.state !== 'inactive') recRef.current.stop();
    } catch {
      /* já parado */
    }
  }
  function descartar() {
    cancelledRef.current = true;
    if (recRef.current && recRef.current.state !== 'inactive') usar();
    else {
      teardownMedia();
      onClose();
    }
  }

  if (!recording)
    return (
      <span className="dict-rec dict-busy" role="status">
        <i className="dict-spin" />
        <span className="dict-time" style={{ minWidth: 0 }}>Preparando…</span>
      </span>
    );

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
      <button type="button" className="dict-send" onClick={usar} aria-label="Usar gravação" title="Usar gravação">
        <svg><use href="#i-check" /></svg>
      </button>
      <button type="button" className="dict-mini danger" onClick={descartar} aria-label="Descartar gravação" title="Descartar">
        <svg><use href="#i-trash" /></svg>
      </button>
    </span>
  );
}
