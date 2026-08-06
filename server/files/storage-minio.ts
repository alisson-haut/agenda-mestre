/* Storage MinIO (S3) — usa as envs que a instalação já define:
   MINIO_SERVER_URL (ex.: https://minio.exemplo.com ou http://host:9000),
   MINIO_ROOT_USER, MINIO_ROOT_PASSWORD e MINIO_BUCKET (opcional).
   Bucket privado, criado no boot; lifecycle aborta multipart órfão em 1 dia. */

import * as Minio from 'minio';
import type { Readable } from 'node:stream';
import { assertKey, type Storage, type StorageStat } from './storage.js';

export function createMinioStorage(): Storage & { init(): Promise<void> } {
  const url = new URL(process.env.MINIO_SERVER_URL!);
  const useSSL = url.protocol === 'https:';
  const client = new Minio.Client({
    endPoint: url.hostname,
    port: url.port ? Number(url.port) : useSSL ? 443 : 80,
    useSSL,
    accessKey: process.env.MINIO_ROOT_USER || '',
    secretKey: process.env.MINIO_ROOT_PASSWORD || '',
    pathStyle: true,
  });
  const bucket = process.env.MINIO_BUCKET || 'agendamestre-files';

  return {
    async init() {
      if (!(await client.bucketExists(bucket))) await client.makeBucket(bucket);
      /* Multipart abandonado (vídeo + queda de conexão): o próprio MinIO
         expira uploads obsoletos (stale_uploads_expiry, padrão 24h) — e o
         minio-js 8.x não serializa regras AbortIncompleteMultipartUpload
         (testado: o builder as descarta), então NÃO tentamos lifecycle aqui. */
      console.log(`storage: MinIO pronto (bucket ${bucket})`);
    },

    async put(key, body, size, mime) {
      await client.putObject(bucket, assertKey(key), body, size, { 'Content-Type': mime });
    },

    async get(key, range) {
      const k = assertKey(key);
      if (range) return client.getPartialObject(bucket, k, range.start, range.end - range.start + 1);
      return client.getObject(bucket, k) as Promise<Readable>;
    },

    async stat(key): Promise<StorageStat | null> {
      try {
        const s = await client.statObject(bucket, assertKey(key));
        return { size: s.size };
      } catch {
        return null;
      }
    },

    async delete(key) {
      await client.removeObject(bucket, assertKey(key)).catch((e: any) => {
        if (e?.code !== 'NoSuchKey' && e?.code !== 'NotFound') throw e;
      });
    },

    async deleteMany(keys) {
      if (!keys.length) return;
      await client.removeObjects(bucket, keys.map(assertKey)).catch((e: any) => {
        console.error('storage: deleteMany parcial:', e?.message || e);
      });
    },

    async list(prefix) {
      return new Promise<string[]>((resolve, reject) => {
        const out: string[] = [];
        const stream = client.listObjectsV2(bucket, prefix, true);
        stream.on('data', (o: any) => o?.name && out.push(o.name));
        stream.on('end', () => resolve(out));
        stream.on('error', reject);
      });
    },
  };
}
