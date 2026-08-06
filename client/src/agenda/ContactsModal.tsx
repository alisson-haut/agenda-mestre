/* Contatos — lista com busca ⇄ formulário (sub-views no MESMO dlg).
   Import CSV discreto no rodapé: "Importar CSV · baixar modelo".
   O estado canônico da lista vive no AgendaApp (onChange). */

import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type ContactPayload } from '../api';
import type { Contact } from './types';
import { uid } from './dates';
import { CropEditor, type CropHandle } from './CropEditor';

interface Props {
  open: boolean;
  session: number;
  narrow: boolean;
  contacts: Contact[] | null;
  onChange(next: Contact[]): void;
  onClose(): void;
  onMsg(m: string): void;
  onConfirm(msg: string, fn: () => void): void;
  onInvalid(msg: string): void;
}

const ordena = (arr: Contact[]) => [...arr].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

export function ContactsModal(p: Props) {
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<Contact | 'new' | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [notes, setNotes] = useState('');
  const [avatar, setAvatar] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const avatarRef = useRef<CropHandle>(null);
  const csvRef = useRef<HTMLInputElement>(null);
  const [cropSession, setCropSession] = useState(0);

  useEffect(() => {
    setQ('');
    setEdit(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.session]);

  const abrirForm = (c: Contact | 'new') => {
    if (c === 'new') {
      setName(''); setPhone(''); setEmail(''); setCompany(''); setNotes(''); setAvatar(null);
    } else {
      setName(c.name); setPhone(c.phone); setEmail(c.email); setCompany(c.company);
      setNotes(c.notes); setAvatar(c.avatar);
    }
    setCropSession((s) => s + 1);
    setEdit(c);
  };

  const lista = p.contacts || [];
  const filtrados = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return lista.filter((c) => !qq || (c.name + ' ' + c.company + ' ' + c.email + ' ' + c.phone).toLowerCase().includes(qq));
  }, [lista, q]);

  async function salvar() {
    const nome = name.trim();
    if (!nome) return p.onInvalid('Informe o nome do contato.');
    const payload: Omit<ContactPayload, 'id'> = {
      name: nome,
      phone: phone.trim(),
      email: email.trim(),
      company: company.trim(),
      notes: notes.trim(),
      avatar: avatarRef.current?.result() ?? avatar,
    };
    setSaving(true);
    try {
      if (edit && edit !== 'new') {
        const salvo = await api.updateContact(edit.id, payload);
        p.onChange(ordena(lista.map((c) => (c.id === salvo.id ? salvo : c))));
        p.onMsg('Contato atualizado');
      } else {
        const salvo = await api.createContact({ id: uid(), ...payload });
        p.onChange(ordena([...lista, salvo]));
        p.onMsg('Contato criado');
      }
      setEdit(null);
    } catch (e: any) {
      if (e?.status === 401) { location.reload(); return; }
      p.onInvalid(e?.message || 'Não consegui salvar o contato');
    } finally {
      setSaving(false);
    }
  }

  function excluir() {
    const c = edit;
    if (!c || c === 'new') return;
    p.onConfirm(`Excluir o contato "${c.name}"?`, async () => {
      try {
        await api.deleteContact(c.id);
        p.onChange(lista.filter((x) => x.id !== c.id));
        p.onMsg('Contato excluído');
      } catch (e: any) {
        p.onInvalid(e?.message || 'Não consegui excluir');
      }
    });
    setEdit(null);
  }

  async function importarCsv(file: File) {
    setImporting(true);
    try {
      const text = await file.text();
      const r = await api.importContactsCsv(text);
      const nova = await api.listContacts();
      p.onChange(nova);
      p.onMsg(
        r.imported
          ? `${r.imported} contato(s) importado(s)${r.skipped ? ` · ${r.skipped} ignorado(s)` : ''}`
          : 'Nenhum contato novo no arquivo.',
      );
    } catch (e: any) {
      p.onInvalid(e?.message || 'Não consegui importar — baixe o modelo e confira o formato.');
    } finally {
      setImporting(false);
    }
  }

  return (
    <div
      id="contactsDlg"
      className={`overlay ${p.open ? 'open' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="ctHead"
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
          <div className="dlg-title" id="ctHead">
            {edit === null ? 'Contatos' : edit === 'new' ? 'Novo contato' : 'Editar contato'}
          </div>
          <button className="iconbtn" data-close aria-label="Fechar"><svg><use href="#i-close" /></svg></button>
        </div>

        {edit === null ? (
          <>
            <div className="dlg-body">
              <input className="inp" placeholder="Buscar contato..." value={q} onChange={(e) => setQ(e.target.value)} />
              {p.contacts === null ? (
                <div className="contact-empty">Carregando contatos...</div>
              ) : filtrados.length ? (
                <div className="contact-list">
                  {filtrados.map((c) => (
                    <button key={c.id} className="contact-row" onClick={() => abrirForm(c)}>
                      <span className="contact-ava">
                        {c.avatar ? <img src={c.avatar} alt="" /> : c.name.charAt(0).toUpperCase()}
                      </span>
                      <span className="contact-main">
                        <span className="contact-name">{c.name}{c.company ? ` — ${c.company}` : ''}</span>
                        <span className="contact-sub">{[c.phone, c.email].filter(Boolean).join(' · ') || '—'}</span>
                      </span>
                      <svg style={{ width: 15, height: 15, color: 'var(--ink-3)' }}><use href="#i-edit" /></svg>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="contact-empty">
                  {q ? 'Nenhum contato encontrado.' : 'Nenhum contato ainda — crie o primeiro ou importe um CSV.'}
                </div>
              )}
              <button className="st-add" onClick={() => abrirForm('new')}>
                <svg style={{ width: 16, height: 16 }}><use href="#i-plus" /></svg> Novo contato
              </button>
            </div>
            <div className="dlg-foot" style={{ flexDirection: 'column', gap: 6 }}>
              <div className="csv-links">
                <button className="linkbtn" disabled={importing} onClick={() => csvRef.current?.click()}>
                  {importing ? 'Importando...' : 'Importar CSV'}
                </button>
                <span>·</span>
                <a className="linkbtn" href="/api/contacts/modelo-csv" download>baixar modelo</a>
              </div>
              <input ref={csvRef} hidden type="file" accept=".csv,text/csv"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void importarCsv(f); e.target.value = ''; }} />
            </div>
          </>
        ) : (
          <>
            <div className="dlg-body">
              <CropEditor
                ref={avatarRef}
                value={avatar}
                onClear={() => setAvatar(null)}
                session={cropSession}
                round
                exportSize={128}
                accentColor="var(--brand)"
                placeholder={<span className="avatar-ph">{(name || '?').charAt(0).toUpperCase()}</span>}
                hint="Foto do contato (opcional)"
                onInvalid={p.onInvalid}
              />
              <div className="field">
                <label className="label" htmlFor="ctName">Nome</label>
                <input className="inp" id="ctName" autoComplete="off" value={name}
                  onChange={(e) => setName(e.target.value)} placeholder="Nome do contato" />
              </div>
              <div className="grid2">
                <div className="field">
                  <label className="label" htmlFor="ctPhone">Telefone</label>
                  <input className="inp" id="ctPhone" type="tel" value={phone}
                    onChange={(e) => setPhone(e.target.value)} placeholder="+55 (11) 9..." />
                </div>
                <div className="field">
                  <label className="label" htmlFor="ctEmail">E-mail</label>
                  <input className="inp" id="ctEmail" type="email" value={email}
                    onChange={(e) => setEmail(e.target.value)} placeholder="nome@exemplo.com" />
                </div>
              </div>
              <div className="field">
                <label className="label" htmlFor="ctCompany">Empresa</label>
                <input className="inp" id="ctCompany" value={company}
                  onChange={(e) => setCompany(e.target.value)} placeholder="Opcional" />
              </div>
              <div className="field">
                <label className="label" htmlFor="ctNotes">Observações</label>
                <textarea className="txt" id="ctNotes" rows={3} value={notes}
                  onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" />
              </div>
            </div>
            <div className="dlg-foot">
              {edit !== 'new' && (
                <button className="btn btn-danger btn-icon" onClick={excluir} aria-label="Excluir contato">
                  <svg><use href="#i-trash" /></svg>
                </button>
              )}
              <div className="spacer" />
              <button className="btn btn-ghost" onClick={() => setEdit(null)}>Cancelar</button>
              <button className="btn btn-primary" disabled={saving} onClick={salvar}>
                {saving ? 'Salvando...' : 'Salvar contato'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
