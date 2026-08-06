/* Editor de recorte de imagem reutilizável (etiquetas e foto de perfil):
   escolher arquivo → arrastar para posicionar + zoom → exporta pequeno
   (data URL webp/jpeg) na hora de salvar, via ref.result(). */
import {
  forwardRef, useEffect, useImperativeHandle, useRef, useState,
  type CSSProperties, type ReactNode,
} from 'react';

export interface CropHandle {
  /** imagem final a persistir: recorte novo, a já salva, ou null (removida) */
  result(): string | null;
}

interface Props {
  /** imagem já salva (data URL) ou null */
  value: string | null;
  onClear(): void;
  /** reinicia o estado de edição quando o modal reabre */
  session: number;
  accentColor?: string;
  placeholder?: ReactNode;
  round?: boolean;
  exportSize?: number;
  hint?: string;
  onInvalid(msg: string): void;
}

const PREVIEW = 140;

export const CropEditor = forwardRef<CropHandle, Props>(function CropEditor(p, ref) {
  const [srcImg, setSrcImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const offRef = useRef({ x: 0, y: 0 });
  const cvRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  useEffect(() => {
    setSrcImg(null);
    setZoom(1);
    offRef.current = { x: 0, y: 0 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.session]);

  function paint(cv: HTMLCanvasElement, size: number) {
    const ctx = cv.getContext('2d');
    if (!ctx || !srcImg) return;
    ctx.clearRect(0, 0, size, size);
    const k = size / PREVIEW;
    const base = Math.max(PREVIEW / srcImg.width, PREVIEW / srcImg.height);
    const sc = base * zoom;
    const w = srcImg.width * sc, h = srcImg.height * sc;
    ctx.drawImage(
      srcImg,
      ((PREVIEW - w) / 2 + offRef.current.x) * k,
      ((PREVIEW - h) / 2 + offRef.current.y) * k,
      w * k,
      h * k,
    );
  }
  useEffect(() => {
    if (cvRef.current && srcImg) paint(cvRef.current, PREVIEW);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srcImg, zoom]);

  function onFile(f: File | undefined) {
    if (!f) return;
    if (!f.type.startsWith('image/')) {
      p.onInvalid('Escolha um arquivo de imagem.');
      return;
    }
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      offRef.current = { x: 0, y: 0 };
      setZoom(1);
      setSrcImg(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      p.onInvalid('Não consegui abrir essa imagem.');
    };
    img.src = url;
  }

  useImperativeHandle(ref, () => ({
    result() {
      if (!srcImg) return p.value;
      const out = document.createElement('canvas');
      out.width = out.height = p.exportSize ?? 96;
      paint(out, out.width);
      let data = out.toDataURL('image/webp', 0.85);
      if (!data.startsWith('data:image/webp')) data = out.toDataURL('image/jpeg', 0.85);
      return data;
    },
  }));

  const tem = !!srcImg || !!p.value;

  return (
    <div className="iconedit">
      <div
        className={`iconedit-preview ${p.round ? 'round' : ''}`}
        style={{ '--c': p.accentColor ?? 'var(--surface-3)' } as CSSProperties}
      >
        {srcImg ? (
          <canvas
            ref={cvRef}
            width={PREVIEW}
            height={PREVIEW}
            onPointerDown={(e) => {
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              dragRef.current = { x: e.clientX, y: e.clientY, ox: offRef.current.x, oy: offRef.current.y };
            }}
            onPointerMove={(e) => {
              const d = dragRef.current;
              if (!d) return;
              offRef.current = { x: d.ox + (e.clientX - d.x), y: d.oy + (e.clientY - d.y) };
              if (cvRef.current) paint(cvRef.current, PREVIEW);
            }}
            onPointerUp={() => (dragRef.current = null)}
            onPointerCancel={() => (dragRef.current = null)}
          />
        ) : p.value ? (
          <img src={p.value} alt="Imagem atual" />
        ) : (
          <div className="iconedit-colorbox">{p.placeholder}</div>
        )}
      </div>
      <div className="iconedit-ctrl">
        <input ref={fileRef} type="file" accept="image/*" hidden
          onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
        <button className="btn" onClick={() => fileRef.current?.click()}>
          <svg><use href="#i-img" /></svg> {tem ? 'Trocar imagem' : 'Escolher imagem'}
        </button>
        {srcImg && (
          <label className="iconedit-zoom">
            <span className="label">Zoom</span>
            <input type="range" min={1} max={3} step={0.01} value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))} />
          </label>
        )}
        {tem && (
          <button className="btn btn-ghost" onClick={() => { setSrcImg(null); p.onClear(); }}>
            Remover imagem
          </button>
        )}
        <div className="iconedit-hint">
          {srcImg ? 'Arraste a imagem para posicionar e ajuste o zoom.' : p.hint ?? ''}
        </div>
      </div>
    </div>
  );
});
