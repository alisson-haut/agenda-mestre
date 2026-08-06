# Integrações externas

## Groq Cloud — transcrição do ditado (`server/transcribe.ts`)

`POST https://api.groq.com/openai/v1/audio/transcriptions`, Bearer
`GROQ_API_KEY`, multipart (file webm/ogg/wav ≤20MB, `model`
whisper-large-v3-turbo — US$0,04/h, `language: pt`). O cliente grava com
MediaRecorder e manda o blob cru; o servidor monta o FormData. Limites do
componente: título 1min, anotações 6min.

## Evolution GO v3 — WhatsApp (`server/notify/evolution.ts`)

Servidor Evolution GO v3 próprio da instalação (self-hosted; a URL e a chave
global vêm das envs `EVOLUTION_BASE_URL` e `EVOLUTION_API_KEY`).

Auth: header `apikey` — chave **global** para `/instance/create`,
`/instance/all`, `/instance/delete/{id}`; **token da instância** para o resto.
Instância por usuário: nome `agendamestre-<8 chars do userId>`, token uuid
gerado por nós e guardado em `notify_settings` (nunca vai ao browser).

| Ação | Endpoint | Observações |
|---|---|---|
| Criar | `POST /instance/create {name, token}` | token OBRIGATÓRIO; **QR já fica pronto após o create** |
| QR | `GET /instance/qr` | resposta `data.qrcode`/`data.code` (minúsculo!) — data URL PNG |
| Status | `GET /instance/status` | `data.Connected`/`data.LoggedIn` (Maiúsculo!) |
| Conectar | `POST /instance/connect {immediate:true, subscribe:['ALL']}` | `immediate:false` NÃO gera QR e derruba sessão ativa |
| Logout | `DELETE /instance/logout` | 400 "client disconnected"/"not connected" = sucesso |
| Enviar | `POST /send/text {number, text}` | número só dígitos DDI+DDD+número |

**Pegadinhas (aprendidas em produção — não "corrigir" sem testar):**
- Capitalização das chaves varia POR ENDPOINT (qr minúsculo, status maiúsculo,
  create devolve minúsculo). Leitores toleram as duas (`qrOf`, `boolOf`).
- Orçamento de **5 QRs (~100s) por sessão**; esgotou → só recriando a
  instância. O `POST /api/notify/whatsapp/connect` escala sozinho:
  já logada → QR disponível → revive (logout→800ms→connect) → delete+create.
- Erros 400 que são ESTADO: "session already logged in" (= conectado),
  "no qr code available" (= aguardando). Ver `isLoggedInError`/`isNoQrError`.
- Wrapper `evoFetch`: timeout 10s, retry 2x só em 5xx (200/600ms), envelope
  `{ok,...}` sem exceptions.

## Resend — e-mail (`server/notify/resend.ts`)

`POST https://api.resend.com/emails`, Bearer `RESEND_API_KEY`, body
`{from: RESEND_FROM, to[], subject, html}`. Sem retry interno (retry é do
outbox). Plano free: **100 e-mails/dia** → teto global do outbox em 95.

O domínio dos remetentes (`RESEND_FROM`/`RESEND_FROM_AUTH`) precisa estar
**verificado no Resend** — pode ser o domínio raiz mesmo que o app rode num
subdomínio. Sem domínio verificado o Resend devolve 403 "domain is not
verified" (sandbox só entrega para o e-mail da própria conta). Registros DNS
exigidos (o painel do Resend lista; no Cloudflare, todos **DNS only/nuvem
cinza**): TXT `resend._domainkey` (DKIM), MX `send`, TXT `send` (SPF) e
opcionalmente `_dmarc`.

Template HTML em `server/notify/templates.ts` — tabela inline-styled no visual
papel-e-tinta (#F3F3EF/#0F6B57), notas escapadas, botão para `APP_URL`.

## MinIO — mídia das notas (`server/files/storage-minio.ts`)

Pacote `minio` (^8) com envs `MINIO_SERVER_URL` (URL completa — o adapter
extrai host/porta/SSL), `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD` e
`MINIO_BUCKET` (padrão `agendamestre-files`, criado no boot com retry ~5x).
O navegador NUNCA fala com o MinIO — proxy autenticado em `/api/files`.

**Pegadinhas (aprendidas testando — não "corrigir" sem testar):**
- `putObject(bucket, key, stream, size, {'Content-Type'})` streama de verdade
  (SEMPRE passar o size — vem do Content-Length); >64MiB vira multipart com
  pico ~64MiB de RAM por upload.
- `setBucketLifecycle` do minio-js **descarta** regras
  `AbortIncompleteMultipartUpload` na serialização XML (regra só com ela →
  "malformed XML"). Não usamos lifecycle: o próprio MinIO expira multipart
  obsoleto (`stale_uploads_expiry`, padrão 24h).
- `getPartialObject(bucket, key, offset, length)` p/ Range/206 (vídeo).
- Erros de "não existe": código `NoSuchKey`/`NotFound` (tratados como ok no
  delete idempotente).
