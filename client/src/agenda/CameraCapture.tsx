/* Câmera in-app (desktop) — overlay fullscreen próprio, acima dos modais.
   Foto: disparos acumulam na bandeja (conjunto) → "Usar N fotos".
   Vídeo: MediaRecorder com preview e "Regravar"/"Usar vídeo" (limite 3min).
   Escape fecha SÓ a câmera (capture phase, antes do handler global).
   No celular o NoteModal nem monta isto — usa <input capture> nativo. */

import { useEffect, useRef, useState } from 'react';
import { pad } from './dates';

const MAX_VIDEO_SECS = 180;
const fmt = (s: number) => `${Math.floor(s / 60)}:${pad(s % 60)}`;

interface Shot {
  blob: Blob;
  url: string;
}

interface Props {
  mode: 'photo' | 'video';
  onDone(items: { blob: Blob; name: string }[]): void;
  onClose(): void;
  onError(msg: string): void;
  onPickFile(): void; /* fallback de upload quando a câmera falha */
}

export function CameraCapture({ mode, onDone, onClose, onError, onPickFile }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | undefined>(undefined);
  const [pronto, setPronto] = useState(false);
  const [falhou, setFalhou] = useState(false);
  const [frontal, setFrontal] = useState(false);
  const [temVarias, setTemVarias] = useState(false);
  const [shots, setShots] = useState<Shot[]>([]);
  const [gravando, setGravando] = useState(false);
  const [secs, setSecs] = useState(0);
  const [preview, setPreview] = useState<{ blob: Blob; url: string; mime: string } | null>(null);

  const pararStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  async function abrir(front: boolean) {
    pararStream();
    setPronto(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: front ? 'user' : 'environment' },
        audio: mode === 'video',
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setPronto(true);
      navigator.mediaDevices
        .enumerateDevices()
        .then((ds) => setTemVarias(ds.filter((d) => d.kind === 'videoinput').length > 1))
        .catch(() => {});
    } catch {
      setFalhou(true);
    }
  }

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setFalhou(true);
      return;
    }
    void abrir(false);
    return () => {
      try {
        if (recRef.current && recRef.current.state !== 'inactive') recRef.current.stop();
      } catch {
        /* já parado */
      }
      window.clearInterval(timerRef.current);
      pararStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Escape fecha só a câmera — capture phase roda antes do handler global */
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', h, true);
    return () => document.removeEventListener('keydown', h, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* previews viram lixo se o componente fechar sem usar */
  useEffect(
    () => () => {
      setShots((old) => {
        for (const s of old) URL.revokeObjectURL(s.url);
        return old;
      });
      setPreview((p) => {
        if (p) URL.revokeObjectURL(p.url);
        return p;
      });
    },
    [],
  );

  function foto() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const cv = document.createElement('canvas');
    cv.width = v.videoWidth;
    cv.height = v.videoHeight;
    const g = cv.getContext('2d')!;
    if (frontal) {
      g.translate(cv.width, 0);
      g.scale(-1, 1);
    }
    g.drawImage(v, 0, 0);
    cv.toBlob(
      (blob) => {
        if (blob) setShots((arr) => [...arr, { blob, url: URL.createObjectURL(blob) }]);
      },
      'image/jpeg',
      0.9,
    );
  }

  function gravar() {
    const stream = streamRef.current;
    if (!stream) return;
    const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
        ? 'video/webm;codecs=vp8'
        : MediaRecorder.isTypeSupported('video/webm')
          ? 'video/webm'
          : MediaRecorder.isTypeSupported('video/mp4')
            ? 'video/mp4'
            : '';
    if (!mime) {
      onError('Este navegador não grava vídeo — envie um arquivo.');
      return;
    }
    chunksRef.current = [];
    const rec = new MediaRecorder(stream, { mimeType: mime });
    recRef.current = rec;
    rec.ondataavailable = (e) => {
      if (e.data.size) chunksRef.current.push(e.data);
    };
    rec.onstop = () => {
      window.clearInterval(timerRef.current);
      setGravando(false);
      const tipo = mime.split(';')[0];
      const blob = new Blob(chunksRef.current, { type: tipo });
      chunksRef.current = [];
      if (blob.size < 2000) return;
      setPreview({ blob, url: URL.createObjectURL(blob), mime: tipo });
    };
    rec.start(500);
    setSecs(0);
    setGravando(true);
    timerRef.current = window.setInterval(() => {
      setSecs((s) => {
        if (s + 1 >= MAX_VIDEO_SECS) pararGravacao();
        return s + 1;
      });
    }, 1000);
  }

  function pararGravacao() {
    try {
      if (recRef.current && recRef.current.state !== 'inactive') recRef.current.stop();
    } catch {
      /* já parado */
    }
  }

  function usarFotos() {
    onDone(shots.map((s, i) => ({ blob: s.blob, name: `foto-${i + 1}.jpg` })));
    onClose();
  }
  function usarVideo() {
    if (!preview) return;
    const ext = preview.mime.includes('mp4') ? 'mp4' : 'webm';
    onDone([{ blob: preview.blob, name: `video.${ext}` }]);
    onClose();
  }

  return (
    <div className="cam-overlay" role="dialog" aria-modal="true" aria-label={mode === 'photo' ? 'Câmera — foto' : 'Câmera — vídeo'}>
      {falhou ? (
        <div className="cam-err">
          <svg style={{ width: 34, height: 34 }}><use href="#i-camera" /></svg>
          <span>Não consegui acessar a câmera.<br />Verifique a permissão do navegador.</span>
          <div style={{ display: 'flex', gap: 9 }}>
            <button className="btn" onClick={() => { setFalhou(false); void abrir(frontal); }}>Tentar de novo</button>
            <button className="btn btn-primary" onClick={() => { onPickFile(); onClose(); }}>Enviar arquivo</button>
          </div>
          <button className="btn btn-ghost" style={{ color: '#fff' }} onClick={onClose}>Fechar</button>
        </div>
      ) : (
        <>
          <video ref={videoRef} className={`cam-video ${frontal ? 'mirror' : ''}`} autoPlay muted playsInline />
          <div className="cam-top">
            <span>{gravando && <span className="cam-timer"><i />{fmt(secs)}</span>}</span>
            <button className="iconbtn" aria-label="Fechar câmera" onClick={onClose}>
              <svg><use href="#i-close" /></svg>
            </button>
          </div>
          <div className="cam-bottom">
            {mode === 'photo' && shots.length > 0 && (
              <div className="cam-tray">
                {shots.map((s, i) => (
                  <div key={s.url} className="media-item">
                    <img src={s.url} alt={`Foto ${i + 1}`} />
                    <button className="m-x" aria-label="Remover foto"
                      onClick={() => setShots((arr) => arr.filter((x) => x !== s))}>
                      <svg><use href="#i-close" /></svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="cam-ctrl">
              <span className="cam-side">
                {temVarias && pronto && (
                  <button className="btn btn-sm" onClick={() => { setFrontal((f) => !f); void abrir(!frontal); }}>
                    <svg style={{ width: 14, height: 14 }}><use href="#i-refresh" /></svg> Trocar
                  </button>
                )}
              </span>
              {mode === 'photo' ? (
                <button className="cam-shutter" aria-label="Tirar foto" disabled={!pronto} onClick={foto} />
              ) : gravando ? (
                <button className="cam-shutter rec" aria-label="Parar gravação" onClick={pararGravacao} />
              ) : (
                <button className="cam-shutter" aria-label="Gravar vídeo" disabled={!pronto} onClick={gravar} />
              )}
              <span className="cam-side">
                {mode === 'photo' && shots.length > 0 && (
                  <button className="btn btn-primary btn-sm" onClick={usarFotos}>
                    Usar {shots.length === 1 ? '1 foto' : `${shots.length} fotos`}
                  </button>
                )}
              </span>
            </div>
          </div>
          {preview && (
            <div className="cam-preview">
              <video src={preview.url} controls autoPlay playsInline />
              <div className="cam-bottom">
                <div className="cam-ctrl">
                  <button className="btn" onClick={() => { URL.revokeObjectURL(preview.url); setPreview(null); }}>
                    Regravar
                  </button>
                  <button className="btn btn-primary" onClick={usarVideo}>Usar vídeo</button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
