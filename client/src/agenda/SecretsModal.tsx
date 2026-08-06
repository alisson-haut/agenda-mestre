/* Cofre Secrets — zero-knowledge no cliente.
   Fases: checking → setup (1º uso) | locked → unlocked ⇄ formulário de item.
   A chave de cifra (EK) vive num useRef e NUNCA em estado; travar = zerar
   ref + itens decifrados. Auto-lock em 2min sem interação (badge regressivo)
   e trava também ao fechar o modal — abrir SEMPRE pede a senha-mestra. */

import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { uid } from './dates';
import {
  decryptItem, deriveKeys, encryptItem, KDF_ITERATIONS, novoSalt,
  type SecretField, type SecretItem,
} from './secretsCrypto';

const LOCK_SECS = 120;

type Phase = 'checking' | 'setup' | 'locked' | 'unlocking' | 'unlocked';

interface Props {
  open: boolean;
  session: number;
  narrow: boolean;
  onClose(): void;
  onMsg(m: string): void;
  onInvalid(msg: string): void;
}

export function SecretsModal(p: Props) {
  const [phase, setPhase] = useState<Phase>('checking');
  const [master, setMaster] = useState('');
  const [master2, setMaster2] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState('');
  const [items, setItems] = useState<SecretItem[]>([]);
  const [corrompidos, setCorrompidos] = useState(0);
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<SecretItem | 'new' | null>(null);
  const [fTitle, setFTitle] = useState('');
  const [fSegment, setFSegment] = useState('');
  const [fFields, setFFields] = useState<SecretField[]>([]);
  const [reveal, setReveal] = useState<Record<string, boolean>>({});
  const [lockIn, setLockIn] = useState(LOCK_SECS);
  const [saving, setSaving] = useState(false);
  const encKeyRef = useRef<CryptoKey | null>(null);
  const tokenRef = useRef('');
  const kdfRef = useRef<{ salt: string; iterations: number } | null>(null);
  const deadlineRef = useRef(0);
  const openRef = useRef(p.open);
  openRef.current = p.open;

  const lock = () => {
    encKeyRef.current = null;
    tokenRef.current = '';
    setItems([]);
    setCorrompidos(0);
    setEdit(null);
    setReveal({});
    setMaster('');
    setMaster2('');
    setErr('');
    setPhase('locked');
  };
  const lockRef = useRef(lock);
  lockRef.current = lock;

  /* abertura: SEMPRE re-verifica o estado do cofre e pede a senha */
  useEffect(() => {
    encKeyRef.current = null;
    tokenRef.current = '';
    setItems([]);
    setCorrompidos(0);
    setEdit(null);
    setReveal({});
    setMaster('');
    setMaster2('');
    setErr('');
    setQ('');
    setPhase('checking');
    api
      .secretsVault()
      .then((v) => {
        if (v.exists) {
          kdfRef.current = { salt: v.salt!, iterations: v.iterations! };
          setPhase('locked');
        } else {
          kdfRef.current = null;
          setPhase('setup');
        }
      })
      .catch(() => {
        setPhase('locked');
        setErr('Não consegui verificar o cofre — tente de novo.');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.session]);

  /* fechar o modal = travar na hora */
  useEffect(() => {
    if (!p.open && encKeyRef.current) lockRef.current();
  }, [p.open]);

  /* auto-lock: 2min sem interação; qualquer pointer/tecla dentro reseta */
  useEffect(() => {
    if (phase !== 'unlocked') return;
    deadlineRef.current = Date.now() + LOCK_SECS * 1000;
    setLockIn(LOCK_SECS);
    const tick = window.setInterval(() => {
      const resta = Math.ceil((deadlineRef.current - Date.now()) / 1000);
      setLockIn(Math.max(0, resta));
      if (resta <= 0) lockRef.current();
    }, 1000);
    const alive = () => {
      deadlineRef.current = Date.now() + LOCK_SECS * 1000;
    };
    const dlg = document.getElementById('secretsDlg');
    dlg?.addEventListener('pointerdown', alive, true);
    dlg?.addEventListener('keydown', alive, true);
    return () => {
      window.clearInterval(tick);
      dlg?.removeEventListener('pointerdown', alive, true);
      dlg?.removeEventListener('keydown', alive, true);
    };
  }, [phase]);

  /* ---------- fluxos ---------- */

  async function criarCofre() {
    if (master.length < 8) return setErr('A senha-mestra precisa de pelo menos 8 caracteres.');
    if (master !== master2) return setErr('As senhas não conferem.');
    setErr('');
    setPhase('unlocking');
    try {
      const salt = novoSalt();
      const { encKey, authKey } = await deriveKeys(master, salt, KDF_ITERATIONS);
      const r = await api.secretsCreateVault(authKey, salt, KDF_ITERATIONS);
      kdfRef.current = { salt, iterations: KDF_ITERATIONS };
      encKeyRef.current = encKey;
      tokenRef.current = r.token;
      setItems([]);
      setMaster('');
      setMaster2('');
      setPhase('unlocked');
      p.onMsg('Cofre criado');
    } catch (e: any) {
      setPhase('setup');
      setErr(e?.message || 'Não consegui criar o cofre.');
    }
  }

  async function destravar() {
    if (!master || !kdfRef.current) return;
    setErr('');
    setPhase('unlocking');
    try {
      const { encKey, authKey } = await deriveKeys(master, kdfRef.current.salt, kdfRef.current.iterations);
      const r = await api.secretsUnlock(authKey);
      encKeyRef.current = encKey;
      tokenRef.current = r.token;
      let ruins = 0;
      const dec: SecretItem[] = [];
      for (const c of r.items) {
        try {
          dec.push(await decryptItem(encKey, c));
        } catch {
          ruins++;
        }
      }
      setItems(dec);
      setCorrompidos(ruins);
      setMaster('');
      setPhase('unlocked');
    } catch (e: any) {
      encKeyRef.current = null;
      setPhase('locked');
      setErr(e?.status === 401 ? 'Senha-mestra incorreta.' : e?.message || 'Não consegui destravar.');
    }
  }

  const abrirItem = (it: SecretItem | 'new') => {
    if (it === 'new') {
      setFTitle('');
      setFSegment('');
      setFFields([
        { id: uid(), label: 'usuário', value: '', secret: false },
        { id: uid(), label: 'senha', value: '', secret: true },
      ]);
    } else {
      setFTitle(it.title);
      setFSegment(it.segment);
      setFFields(it.fields.map((f) => ({ ...f })));
    }
    setEdit(it);
  };

  async function salvarItem() {
    const tt = fTitle.trim();
    if (!tt) return p.onInvalid('Dê um título ao item.');
    const fields = fFields
      .map((f) => ({ ...f, label: f.label.trim(), value: f.value }))
      .filter((f) => f.label || f.value);
    const ek = encKeyRef.current;
    if (!ek) return lock();
    setSaving(true);
    try {
      const corpo = { title: tt, segment: fSegment.trim(), fields };
      const c = await encryptItem(ek, corpo);
      if (edit && edit !== 'new') {
        await api.secretsUpdateItem(tokenRef.current, edit.id, c);
        setItems((arr) => arr.map((x) => (x.id === edit.id ? { id: edit.id, ...corpo } : x)));
      } else {
        const id = uid();
        await api.secretsCreateItem(tokenRef.current, { id, ...c });
        setItems((arr) => [...arr, { id, ...corpo }]);
      }
      setEdit(null);
      p.onMsg('Item salvo no cofre');
    } catch (e: any) {
      if (e?.status === 401) { lock(); p.onInvalid('O cofre travou — destrave de novo.'); return; }
      p.onInvalid(e?.message || 'Não consegui salvar o item.');
    } finally {
      setSaving(false);
    }
  }

  async function excluirItem() {
    const it = edit;
    if (!it || it === 'new') return;
    try {
      await api.secretsDeleteItem(tokenRef.current, it.id);
      setItems((arr) => arr.filter((x) => x.id !== it.id));
      setEdit(null);
      p.onMsg('Item excluído');
    } catch (e: any) {
      if (e?.status === 401) { lock(); return; }
      p.onInvalid(e?.message || 'Não consegui excluir.');
    }
  }

  async function copiar(valor: string) {
    try {
      await navigator.clipboard.writeText(valor);
      p.onMsg('Copiado');
    } catch {
      p.onInvalid('Não consegui copiar — toque no olho e selecione o valor.');
    }
  }

  /* ---------- derivados ---------- */
  const grupos = useMemo(() => {
    const qq = q.trim().toLowerCase();
    const vis = items.filter(
      (it) => !qq || (it.title + ' ' + it.segment + ' ' + it.fields.map((f) => f.label).join(' ')).toLowerCase().includes(qq),
    );
    const map = new Map<string, SecretItem[]>();
    for (const it of vis) {
      const g = it.segment.trim() || 'Geral';
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(it);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'));
  }, [items, q]);

  const fmtLock = `${Math.floor(lockIn / 60)}:${String(lockIn % 60).padStart(2, '0')}`;

  return (
    <div
      id="secretsDlg"
      className={`overlay ${p.open ? 'open' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="sHead"
      onClick={(e) => {
        const el = e.target as HTMLElement;
        if (el === e.currentTarget || el.closest('[data-close]')) p.onClose();
      }}
    >
      <div className="dlg narrow">
        <div className="dlg-head">
          {edit !== null && (
            <button className="iconbtn" aria-label="Voltar" onClick={() => setEdit(null)}>
              <svg><use href="#i-prev" /></svg>
            </button>
          )}
          <div className="dlg-title" id="sHead">Secrets</div>
          {phase === 'unlocked' && (
            <span className={`lock-badge ${lockIn <= 15 ? 'warn' : ''}`} title="O cofre trava sozinho sem interação">
              Trava em {fmtLock}
            </span>
          )}
          <button className="iconbtn" data-close aria-label="Fechar"><svg><use href="#i-close" /></svg></button>
        </div>

        {phase === 'checking' && (
          <div className="dlg-body"><div className="contact-empty">Verificando o cofre...</div></div>
        )}

        {phase === 'setup' && (
          <div className="dlg-body">
            <div className="vault-locked">
              <span className="v-ic"><svg><use href="#i-lock" /></svg></span>
              <p>
                Crie a <b>senha-mestra</b> do cofre. Tudo é criptografado no seu aparelho —
                nem o servidor consegue ler o que você guardar aqui.
              </p>
            </div>
            <div className="vault-warn">
              <b>Importante:</b> não existe recuperação. Se você esquecer a senha-mestra,
              os itens do cofre serão perdidos para sempre.
            </div>
            <div className="field">
              <label className="label" htmlFor="sMaster">Senha-mestra</label>
              <input className="inp" id="sMaster" type={showPw ? 'text' : 'password'} autoComplete="new-password"
                placeholder="Mínimo de 8 caracteres" value={master} onChange={(e) => setMaster(e.target.value)} />
            </div>
            <div className="field">
              <label className="label" htmlFor="sMaster2">Repita a senha-mestra</label>
              <input className="inp" id="sMaster2" type={showPw ? 'text' : 'password'} autoComplete="new-password"
                value={master2} onChange={(e) => setMaster2(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void criarCofre(); }} />
            </div>
            <label className="sfield-sec" style={{ alignSelf: 'flex-start' }}>
              <input type="checkbox" checked={showPw} onChange={(e) => setShowPw(e.target.checked)} /> mostrar senha
            </label>
            {err && <div className="auth-err" role="alert">{err}</div>}
          </div>
        )}

        {(phase === 'locked' || phase === 'unlocking') && (
          <div className="dlg-body">
            <div className="vault-locked">
              <span className="v-ic"><svg><use href="#i-lock" /></svg></span>
              <p>Cofre protegido pela senha-mestra. Nada sai do seu aparelho sem criptografia.</p>
              <div className="field" style={{ width: '100%' }}>
                <label className="label" htmlFor="sMaster">Senha-mestra</label>
                <input className="inp" id="sMaster" type="password" autoComplete="current-password" autoFocus
                  value={master} onChange={(e) => setMaster(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void destravar(); }} />
              </div>
              {err && <div className="auth-err" role="alert">{err}</div>}
            </div>
          </div>
        )}

        {phase === 'unlocked' && edit === null && (
          <div className="dlg-body">
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="inp" placeholder="Buscar no cofre..." value={q} onChange={(e) => setQ(e.target.value)} />
              <button className="btn btn-primary" style={{ flex: 'none' }} onClick={() => abrirItem('new')}>
                <svg style={{ width: 15, height: 15 }}><use href="#i-plus" /></svg> Adicionar
              </button>
            </div>
            {corrompidos > 0 && (
              <div className="vault-warn">{corrompidos} item(ns) não puderam ser decifrados (dados corrompidos).</div>
            )}
            {!items.length && (
              <div className="contact-empty">
                Cofre vazio — guarde logins, senhas e dados sensíveis com "Adicionar".
              </div>
            )}
            {grupos.map(([g, its]) => (
              <div key={g} className="secret-group">
                <div className="secret-gtitle">{g}</div>
                {its.map((it) => (
                  <div key={it.id} className="secret-card">
                    <div className="secret-head">
                      <span className="secret-title">{it.title}</span>
                      <button className="iconbtn" aria-label={`Editar ${it.title}`} onClick={() => abrirItem(it)}>
                        <svg><use href="#i-edit" /></svg>
                      </button>
                    </div>
                    {it.fields.map((f) => (
                      <div key={f.id} className="secret-row">
                        <span className="secret-lab">{f.label || '—'}</span>
                        <span className="secret-val">
                          {f.secret && !reveal[it.id + f.id] ? '••••••••' : f.value}
                        </span>
                        {f.secret && (
                          <button className="iconbtn" aria-label="Mostrar/ocultar"
                            onClick={() => setReveal((r) => ({ ...r, [it.id + f.id]: !r[it.id + f.id] }))}>
                            <svg><use href={reveal[it.id + f.id] ? '#i-eye-off' : '#i-eye'} /></svg>
                          </button>
                        )}
                        <button className="iconbtn" aria-label={`Copiar ${f.label}`} title="Copiar"
                          onClick={() => void copiar(f.value)}>
                          <svg><use href="#i-copy" /></svg>
                        </button>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {phase === 'unlocked' && edit !== null && (
          <>
            <div className="dlg-body">
              <div className="field">
                <label className="label" htmlFor="sTitle">Título</label>
                <input className="inp" id="sTitle" autoComplete="off" placeholder="Ex.: Banco Inter"
                  value={fTitle} onChange={(e) => setFTitle(e.target.value)} />
              </div>
              <div className="field">
                <label className="label" htmlFor="sSegment">Segmento</label>
                <input className="inp" id="sSegment" autoComplete="off" placeholder="Ex.: Bancos, Sites, Servidores..."
                  value={fSegment} onChange={(e) => setFSegment(e.target.value)} />
              </div>
              <div className="field">
                <span className="label">Campos</span>
                {fFields.map((f, i) => (
                  <div key={f.id} className="sfield-row">
                    <input className="inp sf-lab" placeholder="rótulo" value={f.label}
                      onChange={(e) => setFFields((arr) => arr.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                    <input className="inp sf-val" placeholder="valor" type={f.secret ? 'password' : 'text'}
                      autoComplete="off" value={f.value}
                      onChange={(e) => setFFields((arr) => arr.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
                    <label className="sfield-sec" title="Valor sensível: aparece mascarado">
                      <input type="checkbox" checked={f.secret}
                        onChange={(e) => setFFields((arr) => arr.map((x, j) => (j === i ? { ...x, secret: e.target.checked } : x)))} />
                      🔒
                    </label>
                    <button className="lr-x" aria-label="Remover campo"
                      onClick={() => setFFields((arr) => arr.filter((_, j) => j !== i))}>
                      <svg><use href="#i-close" /></svg>
                    </button>
                  </div>
                ))}
                <button className="st-add"
                  onClick={() => setFFields((arr) => [...arr, { id: uid(), label: '', value: '', secret: false }])}>
                  <svg style={{ width: 16, height: 16 }}><use href="#i-plus" /></svg> Adicionar campo
                </button>
              </div>
            </div>
            <div className="dlg-foot">
              {edit !== 'new' && (
                <button className="btn btn-danger btn-icon" onClick={() => void excluirItem()} aria-label="Excluir item">
                  <svg><use href="#i-trash" /></svg>
                </button>
              )}
              <div className="spacer" />
              <button className="btn btn-ghost" onClick={() => setEdit(null)}>Cancelar</button>
              <button className="btn btn-primary" disabled={saving} onClick={() => void salvarItem()}>
                {saving ? 'Salvando...' : 'Salvar item'}
              </button>
            </div>
          </>
        )}

        {phase === 'setup' && (
          <div className="dlg-foot">
            <div className="spacer" />
            <button className="btn btn-ghost" data-close>Cancelar</button>
            <button className="btn btn-primary" onClick={() => void criarCofre()}>Criar cofre</button>
          </div>
        )}
        {(phase === 'locked' || phase === 'unlocking') && (
          <div className="dlg-foot">
            <div className="spacer" />
            <button className="btn btn-primary" disabled={phase === 'unlocking' || !master}
              onClick={() => void destravar()}>
              {phase === 'unlocking' ? 'Derivando chave...' : 'Destravar cofre'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
