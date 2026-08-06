# Backend — API, auth e banco

## Banco: adapter único pg/PGlite (`server/db.ts`)

`getDB()` devolve `{query(sql, params), tx(fn)}`. Com `DATABASE_URL` usa pg
(pool); sem, PGlite em `.data/pglite` (dev). Regras:

- Migração = acrescentar statements idempotentes ao array `SCHEMA`
  (`CREATE TABLE/INDEX IF NOT EXISTS`, `ALTER ... ADD COLUMN IF NOT EXISTS`).
  Rodam no boot, na ordem. Nunca editar statement antigo (bancos já migrados
  não re-executam) — sempre adicionar novo.
- PGlite tem **1 conexão**: `tx()` serializa; jamais fazer I/O de rede dentro
  de transação; operações concorrentes (claim de fila) em statement único
  `UPDATE ... WHERE id IN (SELECT ...) RETURNING`.
- JSONB: gravar com `JSON.stringify`, ler com `asJson` (drivers divergem).
  BIGINT volta como string → `Number()`.

## Auth (`server/auth.ts` + `server/google-auth.ts`)

Cookie `am_session` httpOnly/SameSite=Lax/Secure(prod), token 32 bytes cujo
SHA-256 vai à tabela sessions (30d). `requireAuth` injeta `req.user`.
`limited(key, max, windowMs)` = rate limit em memória (exportado — usar em
rotas sensíveis). Registro relaxa limite fora de produção (e2e cria muitas
contas). Trocar senha derruba as outras sessões. `audit(evt, data)` loga
eventos de auth em JSON (nunca senha/token/hash).

**Recuperação de senha**: `POST /forgot` (resposta SEMPRE genérica — sem
enumeração; rate por IP 5/15min prod + por e-mail 3/15min sempre; token 32B →
SHA-256 em `password_resets`, 30min, uso único, relógio do BANCO via `now()`;
e-mail direto pelo `sendEmail` com `authFrom()` — exceção documentada ao
outbox por ser transacional; **fora de produção a resposta inclui `devLink`**
para os e2e). `POST /reset` valida + consumo atômico em `tx()` + derruba
TODAS as sessões + auto-login. Template em `server/notify/auth-emails.ts`.

**Google OAuth** (`google-auth.ts`, sem libs): só ativa com
GOOGLE_CLIENT_ID/SECRET + APP_URL; `GET /providers` informa o cliente; state
anti-CSRF em cookie 10min; valida id_token via tokeninfo (aud +
email_verified); vincula por google_id ou e-mail existente, cria conta com
senha aleatória se necessário.

**Headers (prod)**: HSTS + CSP (self + Google Fonts + data:/blob: para
imagens e `media-src` para áudio/vídeo) + Permissions-Policy (mic=self e
camera=self — ditado e câmera das notas). Em dev não há CSP (Vite HMR; o
HTML nem passa pelo Express) — **testar câmera/vídeo via `npm run preview`**.

## Estado (`server/state.ts`)

`PUT /api/state` valida (`cleanTask`/`cleanCat` — limites de tamanho, regex de
cor/data/hora, remind 0..10080, cats ≤4, icon data-URL ≤120k) e substitui tudo
em transação. **Não** criar rotas de escrita paralelas para tasks/cats — o
próximo PUT do cliente sobrescreveria; o caminho de escrita é um só.

## Notas, contatos e arquivos (`server/notes.ts`, `server/contacts.ts`, `server/files/`)

Entidades **fora do full-state**: CRUD por operação, todas `requireAuth`,
validação manual estilo `cleanTask`, erros PT-BR. Vínculos FROUXOS por design:
`notes.task_id`/`notes.contact_ids` sem FK (o PUT /api/state recria tasks) e
`note_files` sem FK para notes (o upload acontece ANTES do save — id de nota
gerado no cliente; órfãos >24h sem nota são varridos por `startOrphanSweep`).

**Storage** (`server/files/storage.ts`): adapter MinIO (envs `MINIO_SERVER_URL`
/`MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD`/`MINIO_BUCKET`) ou disco
(dev `.data/files`, prod opt-in `FILES_DIR`); sem nada em prod → 503 padrão.
Chave `<userId>/<noteId>/<fileId>.<ext>` — userId SEMPRE da sessão, ext só do
mapa MIME. **REGRA: storage é I/O de rede — NUNCA dentro de `tx()`** (delete de
nota: SELECT chaves → DELETE rows → objetos por último, best-effort).

**Upload** (`POST /api/files/notes/:id`): corpo cru em STREAMING (o
express.json global ignora não-JSON — não adicionar body-parser genérico!),
Content-Length obrigatório, allowlist MIME por kind (SVG/HTML proibidos —
XSS), tetos foto 15MB/áudio 30MB/vídeo 95MB/anexo 25MB + quota por usuário.
**Download** (`GET /api/files/:id`): dono via sessão, Range/206 (vídeo no
Safari exige), `Content-Disposition: attachment` para anexos, cache
private/immutable.

## Cofre Secrets (`server/secrets.ts` + `client/src/agenda/secretsCrypto.ts`)

**Zero-knowledge**: o cliente deriva PBKDF2-SHA256 600k (senha-mestra + salt)
→ HKDF separa EK (AES-256-GCM, cifra os itens NO NAVEGADOR) e AK (authKey que
vai ao servidor só para verificação — guardado como bcrypt). O banco só tem
salt/iterations (públicos) e ciphertexts opacos — título/segmento ficam DENTRO
do ciphertext. Unlock (`limited` 5/15min, 401 genérico, `audit`) devolve um
**token de 2min (TTL deslizante, Map em memória — 1 processo)** exigido nos
writes via `X-Vault-Token`. Rekey/reset exigem authKey fresco; rekey é atômico
(confere o conjunto de ids no tx). Esquecer a senha-mestra = perda dos itens
(reset apaga tudo — não usa senha da conta: contas Google têm senha aleatória).
NUNCA logar authKey/token/ciphertext.

## Rotas de notificação (`server/notify/routes.ts`)

Todas `requireAuth`. `GET/PUT /settings` (nunca expõe o token da instância),
`POST /whatsapp/connect` (escada: logada → QR pronto → revive → recriar),
`GET /whatsapp/qr` (proxy — token só no servidor), `GET /whatsapp/status`,
`DELETE /whatsapp`, `POST /test/{email|whatsapp}` (com `limited`),
`GET /log` (últimos 30 envios — diagnóstico).
Provedor ausente → 503 com instrução de env (padrão do `transcribe.ts`).

## Env (`server/env.ts`)

Carrega `.env.local` e `.env` no boot (variáveis do ambiente têm prioridade;
valores vazios ignorados). É import **primeiro** do `index.ts`. Editar env →
reiniciar dev (tsx só observa .ts).

## Produção

`npm run build` → esbuild bundla server (+shared) em `dist-server/index.js`
com deps externas; Docker final instala só prod-deps (PGlite é devDep — em
produção `DATABASE_URL` é obrigatório e o boot falha claro sem ele). Static do
front servido pelo Express em prod.
