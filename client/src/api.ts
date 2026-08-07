import type { Cat, Contact, Note, NoteFile, NoteFileKind, Prefs, Task } from './agenda/types';
import type { SecretCipherItem } from './agenda/secretsCrypto';

/** payload de criação/edição de nota (arquivos sobem por /api/files, à parte) */
export interface NotePayload {
  id: string;
  title: string;
  desc: string;
  date: string;
  links: { id: string; url: string; label: string }[];
  contactIds: string[];
  taskId: string | null;
}
export interface ContactPayload {
  id: string;
  name: string;
  phone: string;
  email: string;
  company: string;
  notes: string;
  avatar: string | null;
}

export interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string | null;
}
export interface ServerState {
  cats: Cat[];
  tasks: Task[];
  prefs: Partial<Prefs> | null;
}

export interface NotifySettings {
  emails: string[];
  whatsappNumber: string;
  emailEnabled: boolean;
  whatsappEnabled: boolean;
  timezone: string;
  waInstance: boolean;
  providers: { email: boolean; whatsapp: boolean };
}
export interface WhatsStatus {
  linked: boolean;
  connected: boolean;
  loggedIn: boolean;
  error?: string;
}
export interface WhatsQr {
  qr?: string;
  connected?: boolean;
  pending?: boolean;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    credentials: 'same-origin',
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((body as any)?.error || 'Algo deu errado', res.status);
  return body as T;
}

export const api = {
  me(): Promise<User | null> {
    return req<User>('/api/auth/me').catch((e) => {
      if (e instanceof ApiError && e.status === 401) return null;
      throw e;
    });
  },
  /** cria a conta SEM entrar — o usuário volta ao login */
  register(email: string, password: string, name: string): Promise<void> {
    return req('/api/auth/register', { method: 'POST', body: JSON.stringify({ email, password, name }) });
  },
  /** confirma a senha da conta (ações destrutivas) — 401 se incorreta */
  verifyPassword(password: string): Promise<void> {
    return req('/api/auth/verify', { method: 'POST', body: JSON.stringify({ password }) });
  },
  login(email: string, password: string): Promise<User> {
    return req('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  },
  logout(): Promise<void> {
    return req('/api/auth/logout', { method: 'POST' });
  },
  forgot(email: string): Promise<{ ok: true; message: string; devLink?: string }> {
    return req('/api/auth/forgot', { method: 'POST', body: JSON.stringify({ email }) });
  },
  resetPassword(token: string, password: string): Promise<User> {
    return req('/api/auth/reset', { method: 'POST', body: JSON.stringify({ token, password }) });
  },
  getProviders(): Promise<{ google: boolean }> {
    return req('/api/auth/providers');
  },
  changePassword(current: string, next: string): Promise<void> {
    return req('/api/auth/password', { method: 'POST', body: JSON.stringify({ current, next }) });
  },
  updateProfile(name: string, avatar: string | null): Promise<User> {
    return req('/api/auth/profile', { method: 'PATCH', body: JSON.stringify({ name, avatar }) });
  },
  async transcribe(blob: Blob): Promise<string> {
    const res = await fetch('/api/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': blob.type || 'audio/webm' },
      body: blob,
      credentials: 'same-origin',
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError((body as any)?.error || 'A transcrição falhou', res.status);
    return String((body as any).text || '');
  },
  getNotifySettings(): Promise<NotifySettings> {
    return req('/api/notify/settings');
  },
  putNotifySettings(s: {
    emails: string[];
    whatsappNumber: string;
    emailEnabled: boolean;
    whatsappEnabled: boolean;
    timezone: string;
  }): Promise<NotifySettings> {
    return req('/api/notify/settings', { method: 'PUT', body: JSON.stringify(s) });
  },
  whatsappConnect(): Promise<{ connected: boolean; loggedIn: boolean }> {
    return req('/api/notify/whatsapp/connect', { method: 'POST' });
  },
  whatsappQr(): Promise<WhatsQr> {
    return req('/api/notify/whatsapp/qr');
  },
  whatsappStatus(): Promise<WhatsStatus> {
    return req('/api/notify/whatsapp/status');
  },
  whatsappDisconnect(): Promise<void> {
    return req('/api/notify/whatsapp', { method: 'DELETE' });
  },
  notifyTest(ch: 'email' | 'whatsapp'): Promise<void> {
    return req(`/api/notify/test/${ch}`, { method: 'POST' });
  },
  getState(): Promise<ServerState> {
    return req('/api/state');
  },
  putState(payload: { cats: Cat[]; tasks: Task[]; prefs: Prefs }, keepalive = false): Promise<void> {
    return req('/api/state', { method: 'PUT', body: JSON.stringify(payload), keepalive });
  },

  /* ---------- notas ---------- */
  listNotes(): Promise<Note[]> {
    return req<{ notes: Note[] }>('/api/notes').then((r) => r.notes);
  },
  createNote(p: NotePayload): Promise<Note> {
    return req<{ note: Note }>('/api/notes', { method: 'POST', body: JSON.stringify(p) }).then((r) => r.note);
  },
  updateNote(id: string, p: Omit<NotePayload, 'id'>): Promise<Note> {
    return req<{ note: Note }>(`/api/notes/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(p),
    }).then((r) => r.note);
  },
  deleteNote(id: string): Promise<void> {
    return req(`/api/notes/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  /* upload de mídia — XHR (fetch não expõe progresso de envio) */
  uploadNoteFile(
    noteId: string,
    blob: Blob,
    kind: NoteFileKind,
    name: string,
    onProgress?: (pct: number) => void,
  ): Promise<NoteFile> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const q = `?kind=${encodeURIComponent(kind)}&name=${encodeURIComponent(name)}`;
      xhr.open('POST', `/api/files/notes/${encodeURIComponent(noteId)}${q}`);
      xhr.setRequestHeader('Content-Type', blob.type || 'application/octet-stream');
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        let body: any = {};
        try {
          body = JSON.parse(xhr.responseText);
        } catch {}
        if (xhr.status >= 200 && xhr.status < 300) resolve(body as NoteFile);
        else reject(new ApiError(body?.error || 'O envio falhou', xhr.status));
      };
      xhr.onerror = () => reject(new ApiError('O envio falhou', 0));
      xhr.onabort = () => reject(new ApiError('Envio cancelado', 0));
      xhr.send(blob);
    });
  },
  deleteNoteFile(id: string): Promise<void> {
    return req(`/api/files/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
  filesUsage(): Promise<{ usedBytes: number; quotaBytes: number }> {
    return req('/api/files/usage');
  },

  /* ---------- contatos ---------- */
  listContacts(): Promise<Contact[]> {
    return req<{ contacts: Contact[] }>('/api/contacts').then((r) => r.contacts);
  },
  createContact(p: ContactPayload): Promise<Contact> {
    return req<{ contact: Contact }>('/api/contacts', { method: 'POST', body: JSON.stringify(p) }).then(
      (r) => r.contact,
    );
  },
  updateContact(id: string, p: Omit<ContactPayload, 'id'>): Promise<Contact> {
    return req<{ contact: Contact }>(`/api/contacts/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(p),
    }).then((r) => r.contact);
  },
  deleteContact(id: string): Promise<void> {
    return req(`/api/contacts/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
  importContactsCsv(text: string): Promise<{ imported: number; skipped: number; errors: { line: number; motivo: string }[] }> {
    return req('/api/contacts/import', {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv' },
      body: text,
    });
  },

  /* ---------- cofre Secrets (só authKey/ciphertext trafegam) ---------- */
  secretsVault(): Promise<{ exists: boolean; salt?: string; iterations?: number }> {
    return req('/api/secrets/vault');
  },
  secretsCreateVault(
    authKey: string,
    salt: string,
    iterations: number,
  ): Promise<{ token: string; expiresAt: number; items: SecretCipherItem[] }> {
    return req('/api/secrets/vault', { method: 'POST', body: JSON.stringify({ authKey, salt, iterations }) });
  },
  secretsUnlock(authKey: string): Promise<{ token: string; expiresAt: number; items: SecretCipherItem[] }> {
    return req('/api/secrets/unlock', { method: 'POST', body: JSON.stringify({ authKey }) });
  },
  secretsCreateItem(token: string, item: { id: string; ciphertext: string; iv: string }): Promise<void> {
    return req('/api/secrets/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Vault-Token': token },
      body: JSON.stringify(item),
    });
  },
  secretsUpdateItem(token: string, id: string, c: { ciphertext: string; iv: string }): Promise<void> {
    return req(`/api/secrets/items/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Vault-Token': token },
      body: JSON.stringify(c),
    });
  },
  secretsDeleteItem(token: string, id: string): Promise<void> {
    return req(`/api/secrets/items/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { 'X-Vault-Token': token },
    });
  },
  secretsRekey(p: {
    authKey: string;
    newAuthKey: string;
    newSalt: string;
    newIterations: number;
    items: { id: string; ciphertext: string; iv: string }[];
  }): Promise<{ token: string; expiresAt: number }> {
    return req('/api/secrets/rekey', { method: 'POST', body: JSON.stringify(p) });
  },
  secretsResetVault(): Promise<void> {
    return req('/api/secrets/vault', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: 'APAGAR TUDO' }),
    });
  },
};
