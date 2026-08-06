import type { Cat, Prefs, Task } from './agenda/types';

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
  register(email: string, password: string, name: string): Promise<User> {
    return req('/api/auth/register', { method: 'POST', body: JSON.stringify({ email, password, name }) });
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
};
