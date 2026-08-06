# Deploy do AgendaMestre — VPS Hostinger + EasyPanel + Cloudflare

O app roda em **um container** (front + API na porta 5192) e usa um **Postgres** ao lado.

## 1. Suba o código para o GitHub

Crie um repositório no GitHub (pode ser um fork deste) e envie o código:

```bash
git remote add origin https://github.com/SEU-USUARIO-GITHUB/SEU-REPO.git
git push -u origin main
```

## 2. Instalação em 1 passo (gerador de schema) — RECOMENDADO

Abra **[`installer/index.html`](installer/index.html)** no navegador (duplo
clique no arquivo baixado — é uma página única, 100% offline: nada sai dela).
Preencha o domínio e o que quiser de integrações; a página **gera as senhas**
do Postgres e do MinIO e monta o JSON completo.

1. No EasyPanel, crie o projeto (mesmo nome informado no gerador).
2. Dentro do projeto: **Templates → developer → Create from Schema**.
3. Cole o JSON gerado e confirme. Três serviços nascem de uma vez:
   - **db** — Postgres 17 (usuário/banco já declarados: a conexão nasce certa);
   - **minio** — storage S3 das mídias, **só na rede interna** (sem domínio);
   - **app** — build pelo `Dockerfile` direto do GitHub, exposto na porta 5192.
4. Acompanhe o build e teste `https://seu-dominio/api/health` → `{"ok":true}`.
5. Guarde a **ficha de instalação** (.txt baixado do gerador) — tem as senhas.

> **Tudo o mais é automático no primeiro boot**: migrações do banco (schema
> idempotente), criação do bucket privado no MinIO (com re-tentativas até o
> MinIO subir), worker de notificações e varredura de manutenção. O app também
> espera o Postgres ficar de pé (retry ~2min) — a ordem de subida não importa.

### Alternativa manual (sem o gerador)

O arquivo [`easypanel.json`](easypanel.json) é o mesmo schema com placeholders:
troque `SEU-USUARIO-GITHUB`, `SEU-REPO`, `TROQUE-ESTA-SENHA`,
`TROQUE-USUARIO-MINIO`, `TROQUE-ESTA-SENHA-MINIO` e `agenda.seudominio.com.br`
e cole no mesmo Create from Schema. Ou crie os serviços um a um pela UI
(Postgres → App por imagem `minio/minio` com volume em `/data` → App do GitHub
com as envs da tabela abaixo).

> As integrações (Groq, Resend, Evolution, Google) são opcionais: deixe as
> linhas FORA do env para desligá-las com aviso claro — um placeholder tipo
> `SUA-CHAVE-...` preenchido faz o app achar que estão configuradas e os
> envios falham com erro de autenticação.

## 3. DNS no Cloudflare (ou outro provedor)

### Registro do app

| Tipo | Nome | Conteúdo | Proxy |
|---|---|---|---|
| A | `agenda` (ou o subdomínio que preferir) | IP da sua VPS | comece **DNS only (cinza)** |

Usar um subdomínio (ex.: `agenda.seudominio.com.br`) deixa o domínio raiz
livre para um site/landing. O domínio escolhido deve ser o mesmo do `APP_URL`.

1. No EasyPanel, adicione o domínio ao serviço **app** com **HTTPS** — o
   Let's Encrypt emite o certificado em ~1 min (o desafio HTTP precisa do
   registro em **DNS only**; proxiado ele costuma falhar).
2. Depois do certificado, ative o **proxy (nuvem laranja)** se quiser o CDN/
   WAF do Cloudflare, e configure SSL/TLS da zona como **Full (strict)**.

### Registros do Resend (e-mail)

1. No painel do Resend, **Domains → Add Domain** com o seu domínio (escolha a
   região mais próxima dos usuários).
2. O painel exibe os registros a criar — tipicamente um TXT `resend._domainkey`
   (DKIM), um MX e um TXT SPF no subdomínio `send`. Crie todos no Cloudflare
   como **DNS only (nuvem cinza)** — registros de e-mail não podem ser
   proxiados.
3. Aguarde a verificação (minutos a poucas horas) e use remetentes
   `...@seudominio.com.br` em `RESEND_FROM`/`RESEND_FROM_AUTH`.

Dica: se o Resend sugerir `_dmarc` com `p=reject`, comece com
`v=DMARC1; p=none;` e endureça depois que os envios estiverem estáveis. Sem
domínio verificado, o Resend entrega apenas para o e-mail da própria conta
(modo sandbox).

## 4. Arquivos e mídia (MinIO)

As fotos/vídeos/áudios das notas ficam num **MinIO** (S3) ao lado do app.
O navegador nunca fala com o MinIO — todo upload/download passa pela API
autenticada (`/api/files`), então as credenciais ficam só no servidor.

> **Usou o gerador (seção 2)?** O serviço MinIO já veio no schema, interno-only,
> com credenciais geradas — nada a fazer aqui. Os passos abaixo são o fallback
> para criação manual pela UI.

**No EasyPanel** (criação pela UI):
1. **+ Service → App** → Source: **Docker Image** `minio/minio` (fixe uma
   release, ex.: `minio/minio:RELEASE.2025-04-22T22-12-26Z`).
2. Command: `minio server /data --console-address :9001`.
3. Environment: `MINIO_ROOT_USER` e `MINIO_ROOT_PASSWORD` (senha forte).
4. Mounts: volume em `/data` (é onde os arquivos vivem — inclua no backup).
5. Domínio: opcional. **Sem domínio** o MinIO fica acessível só na rede
   interna (`<projeto>_<serviço>:9000` — mais seguro); **com domínio HTTPS**
   você pode acessar o console e usar a mesma URL no `MINIO_SERVER_URL`.
6. No serviço **app**, aponte as envs `MINIO_*` (tabela abaixo). O bucket é
   criado automaticamente no primeiro boot, sempre privado.

Notas de segurança e limites:
- Objetos são gravados por usuário (`<userId>/...`) e toda leitura valida o
  dono pela sessão — um usuário jamais enxerga arquivo de outro.
- Teto de vídeo padrão **95MB**: com o domínio do app proxiado pelo
  Cloudflare (plano free), corpos acima de 100MB são recusados pelo proxy.
  Sem Cloudflare na frente, aumente com `FILES_MAX_VIDEO_MB`.
- Endurecimento opcional: crie uma access key dedicada só ao bucket do app
  (console do MinIO → Access Keys) e use-a no lugar das credenciais root.
- Alternativa sem MinIO: monte um volume e defina `FILES_DIR` (disco local).

## 5. Atualizações

Com `autoDeploy` ligado, cada `git push` na `main` redisponibiliza o app.
Manual: botão **Deploy** no serviço app.

## Alternativa sem EasyPanel (docker compose direto na VPS)

```bash
POSTGRES_PASSWORD=uma-senha-forte docker compose up -d --build
```

O app sobe em `http://IP-DA-VPS:5192`.

## Variáveis de ambiente

| Variável | Obrigatória | Descrição |
| --- | --- | --- |
| `DATABASE_URL` | em produção | URL do Postgres (`postgres://user:senha@host:5432/db`) |
| `PORT` | não | Porta do servidor (padrão 5192) |
| `NODE_ENV` | sim (`production`) | Ativa serviço do front, cookies `Secure` etc. |
| `GROQ_API_KEY` | para o ditado | Chave da Groq Cloud (https://console.groq.com/keys) — transcrição por voz com `whisper-large-v3-turbo` (US$ 0,04/h de áudio). Sem ela o app funciona, só o ditado fica desativado. |
| `GROQ_STT_MODEL` | não | Modelo de transcrição (padrão `whisper-large-v3-turbo`) |
| `EVOLUTION_BASE_URL` | p/ WhatsApp | URL do servidor Evolution GO v3 (gateway do WhatsApp) |
| `EVOLUTION_API_KEY` | p/ WhatsApp | Chave global do Evolution (cria/apaga instâncias) |
| `RESEND_API_KEY` | p/ e-mail | Chave do Resend (https://resend.com/api-keys) |
| `RESEND_FROM` | p/ e-mail | Remetente, ex.: `AgendaMestre <lembretes@seudominio.com.br>` — o domínio precisa estar verificado no Resend; sem verificação (sandbox), o Resend só entrega para o e-mail da própria conta |
| `APP_URL` | não | URL pública do app — vira o link "Abrir AgendaMestre" nas mensagens |
| `NOTIFY_TICK_MS` | não | Intervalo do worker de notificações (padrão 45000 ms) |
| `NOTIFY_DISABLED` | não | `1` desliga o worker (útil em CI) |
| `NOTIFY_*` (limites) | não | Tetos de segurança do motor de mensageria (janela/min, diário, global, espaçamento) — padrões conservadores; ver [docs/mensageria.md](docs/mensageria.md) |
| `RESEND_FROM_AUTH` | não | Remetente dos e-mails de conta (ex.: `AgendaMestre <no-reply@seudominio.com.br>`) |
| `MINIO_SERVER_URL` | p/ mídia | URL do MinIO — pública (`https://minio.seudominio.com.br`) ou interna (`http://<projeto>_minio:9000`) |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` | p/ mídia | Credenciais do MinIO (ou de uma access key dedicada ao bucket) |
| `MINIO_BUCKET` | não | Nome do bucket (padrão `agendamestre-files`, criado no boot) |
| `FILES_DIR` | não | Alternativa ao MinIO: pasta em disco (monte um volume) |
| `FILES_USER_QUOTA_MB` | não | Cota de mídia por usuário (padrão 500) |
| `FILES_MAX_VIDEO_MB` | não | Teto de vídeo (padrão 95 — limite do proxy Cloudflare free é 100MB) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | não | Ativam o botão "Continuar com Google" — sem eles, o botão fica desabilitado |

## Login com Google (opcional)

1. Google Cloud Console → APIs & Services → Credentials → **Create OAuth client ID**
   (tipo **Web application**).
2. Authorized JavaScript origins: `https://agenda.seudominio.com.br`.
3. Authorized redirect URI: **`https://agenda.seudominio.com.br/api/auth/google/callback`**
   (o `APP_URL` do servidor precisa casar exatamente com o domínio).
4. Cole `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` no Environment do app e
   redeploy — o botão ativa sozinho.

## Notificações (e-mail e WhatsApp)

O worker interno roda dentro do próprio container e dispara lembretes no
horário configurado na tarefa (campo **Lembrete**), com fila persistida na
tabela `notification_log` (dedupe por ocorrência+canal e até 3 tentativas).

- **E-mail**: crie a chave no Resend e verifique seu domínio; depois cada
  usuário salva os e-mails de destino em **Configurações → Notificações**.
- **WhatsApp**: aponte `EVOLUTION_BASE_URL`/`EVOLUTION_API_KEY` para o seu
  servidor Evolution GO v3. Cada usuário conecta o número **remetente** por QR
  code nas Configurações e informa o número de **destino** (DDI+DDD+número).
- Todas as variáveis são opcionais: sem elas o app funciona e as rotas de
  notificação respondem 503 com instrução clara.

> **Ditado por voz e HTTPS**: o navegador só libera o microfone em contexto
> seguro — em produção o ditado exige o domínio com HTTPS (localhost funciona sem).

## Segurança

- Senhas com hash **bcrypt** (custo 12); sessões de 30 dias em cookie **httpOnly + Secure + SameSite=Lax**; token guardado no banco só como SHA-256.
- Limite de tentativas de login por IP+e-mail (10 a cada 10 min).
- Todo o estado é validado e escopado ao usuário autenticado.
