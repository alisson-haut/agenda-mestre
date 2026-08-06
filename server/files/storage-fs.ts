/* Storage em disco — caminho oficial do dev (e opt-in em produção via
   FILES_DIR com volume montado). Chaves já validadas por assertKey. */

import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { assertKey, type Storage, type StorageStat } from './storage.js';

export function createFsStorage(root: string): Storage & { init(): Promise<void> } {
  const abs = (key: string) => path.join(root, ...assertKey(key).split('/'));

  return {
    async init() {
      await mkdir(root, { recursive: true });
    },

    async put(key, body, _size, _mime) {
      const dest = abs(key);
      await mkdir(path.dirname(dest), { recursive: true });
      /* grava num tmp e renomeia — nunca deixa arquivo parcial no destino */
      const tmp = dest + '.tmp-' + crypto.randomBytes(4).toString('hex');
      try {
        await pipeline(body, createWriteStream(tmp, { flags: 'wx' }));
        await rename(tmp, dest);
      } catch (e) {
        await unlink(tmp).catch(() => {});
        throw e;
      }
    },

    async get(key, range) {
      const p = abs(key);
      await stat(p); // ENOENT explode aqui, antes de abrir o stream
      return createReadStream(p, range ? { start: range.start, end: range.end } : undefined) as Readable;
    },

    async stat(key): Promise<StorageStat | null> {
      try {
        const s = await stat(abs(key));
        return { size: s.size };
      } catch {
        return null;
      }
    },

    async delete(key) {
      await rm(abs(key), { force: true });
    },

    async deleteMany(keys) {
      for (const k of keys) await this.delete(k).catch(() => {});
    },

    async list(prefix) {
      const base = abs(prefix);
      const out: string[] = [];
      const walk = async (dir: string, rel: string) => {
        let entries;
        try {
          entries = await readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const e of entries) {
          const r = rel ? rel + '/' + e.name : e.name;
          if (e.isDirectory()) await walk(path.join(dir, e.name), r);
          else out.push(prefix + '/' + r);
        }
      };
      await walk(base, '');
      return out;
    },
  };
}
