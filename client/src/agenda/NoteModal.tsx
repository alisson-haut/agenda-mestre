/* Modal de nota — título/corpo com ditado, mídia (upload imediato com
   progresso; câmera/gravação entram por cima), links e vínculo com contatos.
   Segue o padrão dos modais: overlay sempre montado, `session` reseta o form.
   O id da nota nova nasce AQUI (na abertura) para os uploads acontecerem
   antes do save — o servidor tolera nota inexistente e varre órfãos. */

import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type NotePayload } from '../api';
import type { Contact, Note, NoteFile, NoteFileKind, NoteLink } from './types';
import { uid } from './dates';
import { Dictation } from './Dictation';
import { AudioRecorder } from './AudioRecorder';
import { CameraCapture } from './CameraCapture';
import { AudioPlayer } from './AudioPlayer';
import { MediaViewer } from './MediaViewer';
import type { ConfirmCfg } from './ConfirmModal';

export interface MediaEntry {
  key: string;
  kind: NoteFileKind;
  name: string;
  file: NoteFile | null; /* preenchido quando o upload conclui */
  blob: Blob | null; /* guardado para retry */
  localUrl: string | null; /* preview otimista */
  status: 'sending' | 'ok' | 'err';
  pct: number;
}

interface Props {
  open: boolean;
  session: number;
  editing: Note | null;
  contacts: Contact[] | null;
  narrow: boolean;
  hoverable: boolean;
  onSave(payload: NotePayload, editing: Note | null, gerarTarefa: boolean): void;
  onDelete(): void;
  onClose(): void;
  onManageContacts(): void;
  onAskConfirm(cfg: ConfirmCfg): void;
  onInvalid(msg: string): void;
}

/* espelho da allowlist do servidor — barra cedo, antes de subir */
const KIND_SPEC: Record<NoteFileKind, { accept: string; mimes: string[]; maxMb: number }> = {
  foto: { accept: 'image/*', mimes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'], maxMb: 15 },
  video: { accept: 'video/*', mimes: ['video/mp4', 'video/webm', 'video/quicktime'], maxMb: 95 },
  audio: {
    accept: 'audio/*',
    mimes: ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/m4a', 'audio/x-m4a', 'audio/wav'],
    maxMb: 30,
  },
  anexo: {
    accept: '.pdf,.txt,.csv,.zip,.docx,.xlsx,.pptx',
    mimes: [
      'application/pdf', 'text/plain', 'text/csv', 'application/zip',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ],
    maxMb: 25,
  },
};

const fmtDia = (ymdStr: string) => {
  const [y, m, d] = ymdStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' });
};

export function NoteModal(p: Props) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [links, setLinks] = useState<NoteLink[]>([]);
  const [media, setMedia] = useState<MediaEntry[]>([]);
  const [contactIds, setContactIds] = useState<string[]>([]);
  const [pickOpen, setPickOpen] = useState(false);
  const [pickQ, setPickQ] = useState('');
  /* captura in-app: câmera fullscreen (desktop) e gravador de áudio inline */
  const [cam, setCam] = useState<null | 'photo' | 'video'>(null);
  const [recAudio, setRecAudio] = useState(false);
  /* lightbox de mídia (foto/vídeo/pdf) */
  const [viewer, setViewer] = useState<null | { kind: 'foto' | 'video' | 'pdf'; url: string; name: string }>(null);
  const noteIdRef = useRef('');
  const dayRef = useRef('');
  const taskIdRef = useRef<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const inputsRef = useRef<Partial<Record<NoteFileKind, HTMLInputElement | null>>>({});

  /* reset a cada abertura */
  useEffect(() => {
    setMedia((old) => {
      for (const m of old) if (m.localUrl) URL.revokeObjectURL(m.localUrl);
      return [];
    });
    const n = p.editing;
    if (n) {
      noteIdRef.current = n.id;
      dayRef.current = n.date;
      taskIdRef.current = n.taskId;
      setTitle(n.title);
      setBody(n.desc);
      setLinks(n.links.map((l) => ({ ...l })));
      setContactIds([...n.contactIds]);
      setMedia(
        n.files.map((f) => ({
          key: f.id, kind: f.kind, name: f.name, file: f, blob: null, localUrl: null, status: 'ok', pct: 100,
        })),
      );
    } else {
      noteIdRef.current = uid();
      const hoje = new Date();
      dayRef.current = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(
        hoje.getDate(),
      ).padStart(2, '0')}`;
      taskIdRef.current = null;
      setTitle('');
      setBody('');
      setLinks([]);
      setContactIds([]);
    }
    setPickOpen(false);
    setPickQ('');
    setCam(null);
    setRecAudio(false);
    setViewer(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.session]);

  useEffect(() => {
    if (!p.open) return;
    if (p.editing && p.narrow) return;
    const id = window.setTimeout(() => titleRef.current?.focus(), p.editing ? 70 : 90);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.session, p.open]);

  /* ---------- mídia ---------- */

  const upload = (entryKey: string, blob: Blob, kind: NoteFileKind, name: string) => {
    api
      .uploadNoteFile(noteIdRef.current, blob, kind, name, (pct) =>
        setMedia((arr) => arr.map((m) => (m.key === entryKey ? { ...m, pct } : m))),
      )
      .then((file) =>
        setMedia((arr) => arr.map((m) => (m.key === entryKey ? { ...m, file, status: 'ok', pct: 100 } : m))),
      )
      .catch((e) => {
        setMedia((arr) => arr.map((m) => (m.key === entryKey ? { ...m, status: 'err' } : m)));
        p.onInvalid(e?.message || 'O envio falhou');
      });
  };

  const addBlobs = (kind: NoteFileKind, items: { blob: Blob; name: string }[]) => {
    const spec = KIND_SPEC[kind];
    for (const { blob, name } of items) {
      const mime = (blob.type || '').split(';')[0];
      if (!spec.mimes.includes(mime)) {
        p.onInvalid(`Formato não aceito para ${kind}: ${mime || 'desconhecido'}.`);
        continue;
      }
      if (blob.size > spec.maxMb * 1024 * 1024) {
        p.onInvalid(`Arquivo grande demais (máximo ${spec.maxMb}MB para ${kind}).`);
        continue;
      }
      const key = uid();
      /* áudio também ganha preview local — o player toca o recém-gravado
         antes mesmo do upload terminar */
      const localUrl = kind !== 'anexo' ? URL.createObjectURL(blob) : null;
      setMedia((arr) => [...arr, { key, kind, name, file: null, blob, localUrl, status: 'sending', pct: 0 }]);
      upload(key, blob, kind, name);
    }
  };

  const pickFiles = (kind: NoteFileKind) => {
    /* desktop com câmera → captura in-app; mobile → câmera nativa (capture) */
    const temCam = !!navigator.mediaDevices?.getUserMedia;
    if (kind === 'foto' && p.hoverable && temCam) return setCam('photo');
    if (kind === 'video' && p.hoverable && temCam) return setCam('video');
    if (kind === 'audio') return setRecAudio(true);
    inputsRef.current[kind]?.click();
  };

  const removeLocal = (m: MediaEntry) => {
    if (m.localUrl) URL.revokeObjectURL(m.localUrl);
    setMedia((arr) => arr.filter((x) => x.key !== m.key));
  };

  const removeMedia = (m: MediaEntry) => {
    /* upload pendente/falho não é destrutivo — remove sem cerimônia */
    if (m.status !== 'ok' || !m.file) return removeLocal(m);
    p.onAskConfirm({
      title: 'Excluir arquivo',
      msg: `Excluir "${m.name}" definitivamente?`,
      confirmLabel: 'Excluir',
      danger: true,
      onConfirm: async () => {
        /* falha (rede/401) → erro inline no confirm e o item PERMANECE —
           nada de arquivo fantasma que volta no próximo reload */
        await api.deleteNoteFile(m.file!.id);
        removeLocal(m);
      },
    });
  };

  const retryMedia = (m: MediaEntry) => {
    if (!m.blob) return removeMedia(m);
    setMedia((arr) => arr.map((x) => (x.key === m.key ? { ...x, status: 'sending', pct: 0 } : x)));
    upload(m.key, m.blob, m.kind, m.name);
  };

  const enviando = media.filter((m) => m.status === 'sending').length;
  const comErro = media.filter((m) => m.status === 'err').length;

  /* ---------- salvar ---------- */

  function montarPayload(): NotePayload | null {
    const tt = title.trim();
    const bb = body.trim();
    const ok = media.filter((m) => m.status === 'ok');
    if (!tt && !bb && !ok.length) {
      titleRef.current?.focus();
      p.onInvalid('Escreva algo ou anexe uma mídia para salvar a nota.');
      return null;
    }
    if (enviando) {
      p.onInvalid(`Aguarde: ${enviando} arquivo(s) ainda enviando.`);
      return null;
    }
    if (comErro) {
      p.onInvalid('Reenvie ou remova os arquivos com erro antes de salvar.');
      return null;
    }
    return {
      id: noteIdRef.current,
      title: tt,
      desc: bb,
      date: dayRef.current,
      links: links.map((l) => ({ ...l, url: l.url.trim(), label: l.label.trim() })).filter((l) => l.url),
      contactIds,
      taskId: taskIdRef.current,
    };
  }
  function doSave(gerarTarefa = false) {
    const payload = montarPayload();
    if (payload) p.onSave(payload, p.editing, gerarTarefa);
  }
  const doSaveRef = useRef(doSave);
  doSaveRef.current = doSave;
  useEffect(() => {
    if (!p.open) return;
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        doSaveRef.current();
      }
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [p.open]);

  /* ---------- contatos ---------- */
  const contatos = p.contacts || [];
  const escolhidos = contactIds.map((id) => contatos.find((c) => c.id === id)).filter(Boolean) as Contact[];
  const candidatos = useMemo(() => {
    const q = pickQ.trim().toLowerCase();
    return contatos
      .filter((c) => !contactIds.includes(c.id))
      .filter((c) => !q || (c.name + ' ' + c.company + ' ' + c.email).toLowerCase().includes(q))
      .slice(0, 30);
  }, [contatos, contactIds, pickQ]);

  const head = p.editing ? 'Editar nota' : 'Nova nota';

  return (
    <div
      id="noteDlg"
      className={`overlay ${p.open ? 'open' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="nHead"
      onClick={(e) => {
        const el = e.target as HTMLElement;
        /* durante captura/visualização, o backdrop não fecha (gesto acidental
           perderia a gravação) — só o ✕ explícito */
        if (el === e.currentTarget && (cam || recAudio || viewer)) return;
        if (el === e.currentTarget || el.closest('[data-close]')) p.onClose();
      }}
    >
      <div className="dlg">
        <div className="dlg-head">
          <div className="dlg-title" id="nHead">
            {head} <span className="note-day">· {fmtDia(dayRef.current || new Date().toISOString().slice(0, 10))}</span>
          </div>
          <button className="iconbtn" data-close aria-label="Fechar"><svg><use href="#i-close" /></svg></button>
        </div>
        <div className="dlg-body">
          <div className="dict-wrap">
            <input
              className="inp" id="nTitle" ref={titleRef} placeholder="Título da nota" autoComplete="off"
              value={title} onChange={(e) => setTitle(e.target.value)}
            />
            {p.open && (
              <div className="dict-slot">
                <Dictation
                  label="Ditar o título da nota"
                  maxSecs={60}
                  onText={(t) => setTitle((v) => (v ? v.replace(/\s+$/, '') + ' ' : '') + t)}
                  onError={p.onInvalid}
                />
              </div>
            )}
          </div>
          <div className="dict-wrap multi">
            <textarea
              className="txt" id="nBody" placeholder="Escreva a nota... (ou dite pelo microfone)"
              rows={4} value={body} onChange={(e) => setBody(e.target.value)}
            />
            {p.open && (
              <div className="dict-slot">
                <Dictation
                  label="Ditar a nota"
                  maxSecs={360}
                  onText={(t) => setBody((v) => (v ? v.replace(/\s+$/, '') + '\n' : '') + t)}
                  onError={p.onInvalid}
                />
              </div>
            )}
          </div>

          <div className="field">
            <span className="label">Mídia</span>
            <div className="note-actions">
              <button className="btn" onClick={() => pickFiles('foto')}>
                <svg><use href="#i-camera" /></svg> Foto
              </button>
              <button className="btn" onClick={() => pickFiles('video')}>
                <svg><use href="#i-video" /></svg> Vídeo
              </button>
              <button className="btn" onClick={() => pickFiles('audio')}>
                <svg><use href="#i-mic" /></svg> Áudio
              </button>
              <button className="btn" onClick={() => pickFiles('anexo')}>
                <svg><use href="#i-clip" /></svg> Anexar
              </button>
            </div>
            {recAudio && (
              <div className="dict-rec-wrap" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <AudioRecorder
                  onDone={(blob, mime) => {
                    const ext = mime === 'audio/mp4' ? 'm4a' : mime === 'audio/ogg' ? 'ogg' : 'webm';
                    addBlobs('audio', [{ blob, name: `gravacao.${ext}` }]);
                  }}
                  onError={p.onInvalid}
                  onClose={() => setRecAudio(false)}
                  onPickFile={() => inputsRef.current.audio?.click()}
                />
                <button className="linkbtn" onClick={() => { setRecAudio(false); inputsRef.current.audio?.click(); }}>
                  enviar arquivo
                </button>
              </div>
            )}
            {/* inputs ocultos — no celular, capture abre a câmera nativa */}
            <input hidden type="file" accept={KIND_SPEC.foto.accept} capture="environment" multiple
              ref={(el) => { inputsRef.current.foto = el; }}
              onChange={(e) => { addBlobs('foto', [...(e.target.files || [])].map((f) => ({ blob: f, name: f.name }))); e.target.value = ''; }} />
            <input hidden type="file" accept={KIND_SPEC.video.accept} capture="environment"
              ref={(el) => { inputsRef.current.video = el; }}
              onChange={(e) => { addBlobs('video', [...(e.target.files || [])].map((f) => ({ blob: f, name: f.name }))); e.target.value = ''; }} />
            <input hidden type="file" accept={KIND_SPEC.audio.accept}
              ref={(el) => { inputsRef.current.audio = el; }}
              onChange={(e) => { addBlobs('audio', [...(e.target.files || [])].map((f) => ({ blob: f, name: f.name }))); e.target.value = ''; }} />
            <input hidden type="file" accept={KIND_SPEC.anexo.accept} multiple
              ref={(el) => { inputsRef.current.anexo = el; }}
              onChange={(e) => { addBlobs('anexo', [...(e.target.files || [])].map((f) => ({ blob: f, name: f.name }))); e.target.value = ''; }} />
            {media.length > 0 && (
              <div className="media-grid">
                {media.map((m) => {
                  const url = m.localUrl || m.file?.url || '';
                  const ehPdf = m.kind === 'anexo' && (m.file?.mime === 'application/pdf' || /\.pdf$/i.test(m.name));
                  const abrivel = m.kind === 'foto' || m.kind === 'video' || ehPdf;
                  const abrir = () => {
                    if (!url) return;
                    if (m.kind === 'foto') setViewer({ kind: 'foto', url, name: m.name });
                    else if (m.kind === 'video') setViewer({ kind: 'video', url, name: m.name });
                    else if (ehPdf && m.file) setViewer({ kind: 'pdf', url: m.file.url, name: m.name });
                    else if (m.file) window.open(m.file.url, '_blank', 'noopener'); /* anexo comum: baixar */
                  };
                  return (
                    <div
                      key={m.key}
                      className={`media-item ${m.kind === 'audio' ? 'audio' : ''} ${m.status === 'err' ? 'err' : ''} ${abrivel ? 'media-open' : ''}`}
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest('.m-x, .m-retry, .ap')) return;
                        abrir();
                      }}
                    >
                      {m.kind === 'foto' && url && <img src={url} alt={m.name} loading="lazy" />}
                      {m.kind === 'video' && url && (
                        <video src={url} muted playsInline preload="metadata" />
                      )}
                      {m.kind === 'audio' && url && <AudioPlayer src={url} />}
                      {m.kind === 'anexo' && (
                        <span className="m-ic">
                          <svg><use href="#i-clip" /></svg>
                          <span>{m.name}</span>
                        </span>
                      )}
                      {m.status === 'err' ? (
                        <button className="m-retry" onClick={() => retryMedia(m)}>
                          <svg style={{ width: 16, height: 16 }}><use href="#i-refresh" /></svg>
                          Tentar de novo
                        </button>
                      ) : (
                        <button className="m-x" aria-label={`Remover ${m.name}`} onClick={() => removeMedia(m)}>
                          <svg><use href="#i-close" /></svg>
                        </button>
                      )}
                      {m.status === 'sending' && (
                        <span className="m-bar"><i style={{ width: `${m.pct}%` }} /></span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="field">
            <span className="label">Links</span>
            {links.map((l, i) => (
              <div key={l.id} className="link-row">
                <input className="inp" type="url" placeholder="https://..." value={l.url}
                  onChange={(e) => setLinks((arr) => arr.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
                <input className="inp" style={{ maxWidth: '34%' }} placeholder="Rótulo" value={l.label}
                  onChange={(e) => setLinks((arr) => arr.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                <button className="lr-x" aria-label="Remover link"
                  onClick={() => setLinks((arr) => arr.filter((_, j) => j !== i))}>
                  <svg><use href="#i-close" /></svg>
                </button>
              </div>
            ))}
            <button className="st-add" onClick={() => setLinks((arr) => [...arr, { id: uid(), url: '', label: '' }])}>
              <svg style={{ width: 16, height: 16 }}><use href="#i-link" /></svg> Adicionar link
            </button>
          </div>

          <div className="field">
            <span className="label">Contatos</span>
            <div className="cpick-wrap">
              <div className="cpick">
                {escolhidos.map((c) => (
                  <span key={c.id} className="cpick-chip">
                    {c.name}
                    <button className="cp-x" aria-label={`Desvincular ${c.name}`}
                      onClick={() => setContactIds((arr) => arr.filter((x) => x !== c.id))}>
                      <svg><use href="#i-close" /></svg>
                    </button>
                  </span>
                ))}
                <button className="btn btn-ghost btn-sm" onClick={() => setPickOpen((o) => !o)}>
                  <svg style={{ width: 14, height: 14 }}><use href="#i-users" /></svg> Vincular
                </button>
              </div>
              {pickOpen && (
                <div className="cpick-pop">
                  <input className="inp" placeholder="Buscar contato..." autoFocus value={pickQ}
                    onChange={(e) => setPickQ(e.target.value)} />
                  {candidatos.map((c) => (
                    <button key={c.id} className="cpick-opt"
                      onClick={() => { setContactIds((arr) => [...arr, c.id].slice(0, 20)); setPickOpen(false); setPickQ(''); }}>
                      <span className="contact-ava">{c.avatar ? <img src={c.avatar} alt="" /> : c.name.charAt(0).toUpperCase()}</span>
                      <span>{c.name}{c.company ? ` — ${c.company}` : ''}</span>
                    </button>
                  ))}
                  {!candidatos.length && (
                    <div className="cpick-empty">
                      {p.contacts === null ? 'Carregando contatos...' : 'Nenhum contato encontrado.'}
                    </div>
                  )}
                  <button className="linkbtn" style={{ margin: '4px auto 2px', display: 'block' }}
                    onClick={() => { setPickOpen(false); p.onManageContacts(); }}>
                    Gerenciar contatos
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="dlg-foot">
          <span className="save-hint">⌘↵ salva</span>
          {p.editing && (
            <button className="btn btn-danger btn-icon" onClick={p.onDelete} aria-label="Excluir nota">
              <svg><use href="#i-trash" /></svg>
            </button>
          )}
          <button className="btn btn-ghost" onClick={() => doSave(true)} title="Salva a nota e abre uma tarefa pré-preenchida">
            <svg style={{ width: 15, height: 15 }}><use href="#i-zap" /></svg> Gerar tarefa
          </button>
          <div className="spacer" />
          <button className="btn btn-ghost" data-close>Cancelar</button>
          <button className="btn btn-primary" onClick={() => doSave(false)} disabled={enviando > 0}>
            {enviando > 0 ? `Enviando ${enviando}...` : 'Salvar nota'}
          </button>
        </div>
      </div>
      {cam && (
        <CameraCapture
          mode={cam}
          onDone={(items) => addBlobs(cam === 'photo' ? 'foto' : 'video', items)}
          onClose={() => setCam(null)}
          onError={p.onInvalid}
          onPickFile={() => inputsRef.current[cam === 'photo' ? 'foto' : 'video']?.click()}
        />
      )}
      {viewer && <MediaViewer {...viewer} onClose={() => setViewer(null)} />}
    </div>
  );
}
