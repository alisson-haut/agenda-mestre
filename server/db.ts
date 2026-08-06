/* Camada de banco: Postgres real quando DATABASE_URL existe (produção),
   PGlite (Postgres embutido, arquivo local) no dev — zero instalação. */

export interface Q {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>;
}
export interface DB extends Q {
  tx<T>(fn: (q: Q) => Promise<T>): Promise<T>;
}

const SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`,
  `CREATE TABLE IF NOT EXISTS categories (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    icon TEXT,
    position INT NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, id)
  )`,
  `CREATE TABLE IF NOT EXISTS tasks (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    title TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    cat TEXT NOT NULL DEFAULT '',
    date TEXT,
    time TEXT,
    dur INT NOT NULL DEFAULT 60,
    prio TEXT NOT NULL DEFAULT 'media',
    cats JSONB NOT NULL DEFAULT '[]',
    rec JSONB NOT NULL DEFAULT '{"type":"none","until":null}',
    subs JSONB NOT NULL DEFAULT '[]',
    done_dates JSONB NOT NULL DEFAULT '[]',
    done BOOLEAN NOT NULL DEFAULT false,
    created BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, id)
  )`,
  /* migrações para bancos criados antes destes campos */
  `ALTER TABLE categories ADD COLUMN IF NOT EXISTS icon TEXT`,
  `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS cats JSONB NOT NULL DEFAULT '[]'`,
  `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS remind INT`,
  `CREATE TABLE IF NOT EXISTS notify_settings (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    emails JSONB NOT NULL DEFAULT '[]',
    whatsapp_number TEXT NOT NULL DEFAULT '',
    email_enabled BOOLEAN NOT NULL DEFAULT false,
    whatsapp_enabled BOOLEAN NOT NULL DEFAULT false,
    wa_instance_name TEXT,
    wa_instance_token TEXT,
    timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS notification_log (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    task_id TEXT NOT NULL,
    dk TEXT NOT NULL,
    fire_at TIMESTAMPTZ NOT NULL,
    channel TEXT NOT NULL,
    recipient TEXT NOT NULL DEFAULT '',
    subject TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INT NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_error TEXT,
    provider_message_id TEXT,
    dedupe_key TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at TIMESTAMPTZ
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_nlog_dedupe ON notification_log(dedupe_key)`,
  `CREATE INDEX IF NOT EXISTS idx_nlog_due ON notification_log(status, fire_at)`,
  `CREATE INDEX IF NOT EXISTS idx_nlog_user ON notification_log(user_id, status)`,
  `ALTER TABLE notification_log ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'lembrete'`,
  `CREATE INDEX IF NOT EXISTS idx_nlog_sent ON notification_log(user_id, channel, sent_at)`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar TEXT`,
  `CREATE TABLE IF NOT EXISTS password_resets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_pwreset_user ON password_resets(user_id)`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id TEXT`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google ON users(google_id)`,
  `CREATE TABLE IF NOT EXISTS prefs (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    data JSONB NOT NULL DEFAULT '{}'
  )`,
  /* contatos — CRUD próprio, fora do full-state sync */
  `CREATE TABLE IF NOT EXISTS contacts (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    company TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    avatar TEXT,
    created BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, id)
  )`,
  /* notas — registradas no dia de criação (date), vínculos frouxos com
     tarefa (task_id) e contatos (contact_ids): sem FK de propósito */
  `CREATE TABLE IF NOT EXISTS notes (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    descr TEXT NOT NULL DEFAULT '',
    date TEXT NOT NULL,
    links JSONB NOT NULL DEFAULT '[]',
    contact_ids JSONB NOT NULL DEFAULT '[]',
    task_id TEXT,
    created BIGINT NOT NULL DEFAULT 0,
    updated BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_notes_user_date ON notes(user_id, date)`,
  /* mídias das notas — SEM FK para notes: o upload acontece antes do save
     da nota (id gerado no cliente); órfãos são varridos por idade */
  `CREATE TABLE IF NOT EXISTS note_files (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    note_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    mime TEXT NOT NULL,
    ext TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    size BIGINT NOT NULL,
    created BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_note_files_note ON note_files(user_id, note_id)`,
  /* cofre Secrets — zero-knowledge: o servidor só guarda o verificador
     bcrypt(authKey) e ciphertexts opacos (título/segmento ficam DENTRO
     do ciphertext); salt/iterations são públicos por design */
  `CREATE TABLE IF NOT EXISTS secrets_vault (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    auth_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    iterations INT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS secrets_items (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    ciphertext TEXT NOT NULL,
    iv TEXT NOT NULL,
    created BIGINT NOT NULL DEFAULT 0,
    updated BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, id)
  )`,
];

let dbPromise: Promise<DB> | null = null;

async function createDB(): Promise<DB> {
  const url = process.env.DATABASE_URL;
  if (!url && process.env.NODE_ENV === 'production')
    throw new Error('DATABASE_URL é obrigatório em produção (aponte para o Postgres).');
  let db: DB;
  if (url) {
    const pgMod = await import('pg');
    const pool = new pgMod.default.Pool({ connectionString: url, max: 10 });
    db = {
      query: (sql, params) => pool.query(sql, params as any[]),
      tx: async (fn) => {
        const c = await pool.connect();
        try {
          await c.query('BEGIN');
          const r = await fn({ query: (s, p) => c.query(s, p as any[]) });
          await c.query('COMMIT');
          return r;
        } catch (e) {
          await c.query('ROLLBACK').catch(() => {});
          throw e;
        } finally {
          c.release();
        }
      },
    };
    /* instalação nova: o Postgres pode subir DEPOIS do app (EasyPanel não
       ordena serviços) — espera com backoff (~2min) antes de desistir */
    for (let i = 0; i < 10; i++) {
      try {
        await db.query('SELECT 1');
        break;
      } catch (e: any) {
        if (i === 9) throw e;
        const espera = Math.min(2000 * (i + 1), 15_000);
        console.error(`banco: aguardando o Postgres (tentativa ${i + 1}/10):`, e?.message || e);
        await new Promise((r) => setTimeout(r, espera));
      }
    }
  } else {
    // dev/teste: Postgres embutido em .data/pglite
    const { mkdirSync } = await import('node:fs');
    mkdirSync('.data/pglite', { recursive: true });
    const { PGlite } = await import('@electric-sql/pglite');
    const lite = new PGlite('.data/pglite');
    db = {
      query: (sql, params) => lite.query(sql, params as any[]),
      tx: (fn) => lite.transaction((t) => fn({ query: (s, p) => t.query(s, p as any[]) })) as Promise<any>,
    };
  }
  for (const stmt of SCHEMA) await db.query(stmt);
  return db;
}

export function getDB(): Promise<DB> {
  if (!dbPromise) dbPromise = createDB();
  return dbPromise;
}
