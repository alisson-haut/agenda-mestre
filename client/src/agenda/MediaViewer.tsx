/* Visualizador de mídia da nota — lightbox próprio acima de tudo (z 460).
   foto = imagem grande; vídeo = player nativo com controles (Range/206 dá o
   seek); pdf = iframe same-origin (a rota /api/files libera framing SÓ para
   application/pdf) + botão "abrir em nova aba" (obrigatório no mobile, onde
   iframe de PDF não renderiza). Escape em capture phase fecha SÓ o viewer. */

import { useEffect } from 'react';

interface Props {
  kind: 'foto' | 'video' | 'pdf';
  url: string;
  name: string;
  onClose(): void;
}

export function MediaViewer(p: Props) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        p.onClose();
      }
    };
    document.addEventListener('keydown', h, true);
    return () => document.removeEventListener('keydown', h, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="mviewer"
      role="dialog"
      aria-modal="true"
      aria-label={p.name}
      onClick={(e) => {
        if (e.target === e.currentTarget) p.onClose();
      }}
    >
      <div className="mviewer-top">
        <span className="mviewer-name">{p.name}</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn btn-sm mviewer-open"
          onClick={() => window.open(p.url, '_blank', 'noopener')}>
          <svg style={{ width: 14, height: 14 }}><use href="#i-download" /></svg> Abrir em nova aba
        </button>
        <button type="button" className="iconbtn mviewer-x" aria-label="Fechar visualizador" onClick={p.onClose}>
          <svg><use href="#i-close" /></svg>
        </button>
      </div>
      <div className="mviewer-body" onClick={(e) => { if (e.target === e.currentTarget) p.onClose(); }}>
        {p.kind === 'foto' && <img src={p.url} alt={p.name} />}
        {p.kind === 'video' && <video src={p.url} controls autoPlay playsInline />}
        {p.kind === 'pdf' && <iframe src={p.url} title={p.name} />}
      </div>
    </div>
  );
}
