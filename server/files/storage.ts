/* Storage de mídia das notas — adapter com duas implementações:
   MinIO (produção/dev com MINIO_SERVER_URL) e disco local (dev sem env,
   ou FILES_DIR explícito). O navegador NUNCA fala com o storage: todo
   acesso passa pelas rotas autenticadas de files/routes.ts.

   REGRA (PGlite): nenhuma chamada deste módulo pode acontecer dentro de
   um db.tx() — upload/delete são I/O de rede/disco. */

import type { Readable } from 'node:stream';

export interface StorageStat {
  size: number;
}
export interface Storage {
  put(key: string, body: Readable, size: number, mime: string): Promise<void>;
  get(key: string, range?: { start: number; end: number }): Promise<Readable>;
  stat(key: string): Promise<StorageStat | null>;
  delete(key: string): Promise<void>; // idempotente: inexistente = ok
  deleteMany(keys: string[]): Promise<void>; // best-effort
  list(prefix: string): Promise<string[]>;
}

const DEV = process.env.NODE_ENV !== 'production';

export function storageConfigured(): boolean {
  return !!(process.env.MINIO_SERVER_URL || process.env.FILES_DIR || DEV);
}

/* segmentos de chave são SEMPRE ids internos (uuid/ids validados) — nunca
   input livre; a checagem extra barra path traversal por construção */
const SEG_RE = /^[A-Za-z0-9._-]{1,80}$/;
export function assertKey(key: string): string {
  const parts = key.split('/');
  if (!parts.length || parts.some((p) => !SEG_RE.test(p) || p === '.' || p === '..'))
    throw new Error('chave de objeto inválida: ' + key);
  return key;
}

let singleton: Promise<Storage> | null = null;

async function create(): Promise<Storage> {
  if (process.env.MINIO_SERVER_URL) {
    const { createMinioStorage } = await import('./storage-minio.js');
    return createMinioStorage();
  }
  const { createFsStorage } = await import('./storage-fs.js');
  return createFsStorage(process.env.FILES_DIR || '.data/files');
}

export function getStorage(): Promise<Storage> {
  if (!singleton) singleton = create();
  return singleton;
}

/* boot: cria bucket/pasta com retry — o MinIO pode subir depois do app */
export async function initStorage(): Promise<void> {
  if (!storageConfigured()) return;
  for (let i = 0; i < 5; i++) {
    try {
      const s = await getStorage();
      if ('init' in s && typeof (s as any).init === 'function') await (s as any).init();
      return;
    } catch (e: any) {
      console.error(`storage: init falhou (tentativa ${i + 1}/5):`, e?.message || e);
      if (i === 4) return;
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
}
