import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Cat } from './types';
import { PALETA } from './seed';
import { CropEditor, type CropHandle } from './CropEditor';

interface Props {
  open: boolean;
  session: number;
  editing: Cat | null;
  defaultColor: string;
  canDelete: boolean;
  onSave(name: string, color: string, icon: string | null): void;
  onDelete(): void;
  onClose(): void;
  onInvalid(msg: string): void;
}

export function CatModal(p: Props) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(PALETA[0]);
  const [icon, setIcon] = useState<string | null>(null);
  const cropRef = useRef<CropHandle>(null);

  useEffect(() => {
    setName(p.editing ? p.editing.name : '');
    setColor(p.editing ? p.editing.color : p.defaultColor);
    setIcon(p.editing?.icon || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.session]);

  useEffect(() => {
    if (!p.open) return;
    const id = window.setTimeout(() => document.getElementById('cName')?.focus(), 90);
    return () => window.clearTimeout(id);
  }, [p.session, p.open]);

  function doSave() {
    const n = name.trim();
    if (!n) {
      document.getElementById('cName')?.focus();
      p.onInvalid('Dê um nome à etiqueta.');
      return;
    }
    p.onSave(n, color, cropRef.current?.result() ?? icon);
  }

  return (
    <div
      className={`overlay ${p.open ? 'open' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="cHead"
      onClick={(e) => {
        const el = e.target as HTMLElement;
        if (el === e.currentTarget || el.closest('[data-close]')) p.onClose();
      }}
    >
      <div className="dlg narrow">
        <div className="dlg-head">
          <div className="dlg-title" id="cHead">{p.editing ? 'Editar etiqueta' : 'Nova etiqueta'}</div>
          <button className="iconbtn" data-close aria-label="Fechar"><svg><use href="#i-close" /></svg></button>
        </div>
        <div className="dlg-body">
          <div className="field">
            <label className="label" htmlFor="cName">Nome</label>
            <input className="inp" id="cName" placeholder="Ex.: Academia" autoComplete="off" value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') doSave(); }} />
          </div>
          <div className="field">
            <span className="label">Cor</span>
            <div className="swatches">
              {PALETA.map((c) => (
                <button key={c} className="swatch" style={{ '--c': c } as CSSProperties}
                  aria-pressed={c === color} aria-label={`Cor ${c}`} onClick={() => setColor(c)} />
              ))}
            </div>
          </div>
          <div className="field">
            <span className="label">Ícone com imagem (opcional)</span>
            <CropEditor
              ref={cropRef}
              value={icon}
              session={p.session}
              accentColor={color}
              placeholder="só cor"
              hint="Sem imagem, o ícone usa a cor da etiqueta."
              onClear={() => setIcon(null)}
              onInvalid={p.onInvalid}
            />
          </div>
        </div>
        <div className="dlg-foot">
          {p.editing && (
            <button className="btn btn-danger btn-icon" onClick={p.onDelete} aria-label="Excluir etiqueta">
              <svg><use href="#i-trash" /></svg>
            </button>
          )}
          <div className="spacer" />
          <button className="btn btn-ghost" data-close>Cancelar</button>
          <button className="btn btn-primary" onClick={doSave}>Salvar</button>
        </div>
      </div>
    </div>
  );
}
