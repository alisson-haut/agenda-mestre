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
imagens) + Permissions-Policy (mic=self — o ditado precisa). Em dev não há
CSP (Vite HMR; o HTML nem passa pelo Express).

## Estado (`server/state.ts`)

`PUT /api/state` valida (`cleanTask`/`cleanCat` — limites de tamanho, regex de
cor/data/hora, remind 0..10080, cats ≤4, icon data-URL ≤120k) e substitui tudo
em transação. **Não** criar rotas de escrita paralelas para tasks/cats — o
próximo PUT do cliente sobrescreveria; o caminho de escrita é um só.

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
