# Deploy do AgendaMestre — VPS Hostinger + EasyPanel + Cloudflare

O app roda em **um container** (front + API na porta 5192) e usa um **Postgres** ao lado.

## 1. Suba o código para o GitHub

Crie um repositório no GitHub (pode ser um fork deste) e envie o código:

```bash
git remote add origin https://github.com/SEU-USUARIO-GITHUB/SEU-REPO.git
git push -u origin main
```

## 2. Instalação no EasyPanel (pelo arquivo)

1. No EasyPanel, crie o projeto **agendamestre**.
2. Clique em **+ Service → Create from Schema** (colar JSON).
3. Abra o arquivo [`easypanel.json`](easypanel.json) deste repositório, troque os
   placeholders (`SEU-USUARIO-GITHUB`, `SEU-REPO`, `TROQUE-ESTA-SENHA`,
   `agenda.seudominio.com.br`) e cole o conteúdo.
4. Confirme. O EasyPanel cria dois serviços:
   - **db** — Postgres 17 com volume persistente;
   - **app** — build pelo `Dockerfile` do repositório, exposto na porta 5192.

> Se a sua versão do EasyPanel não aceitar o schema, crie manualmente:
> 1. **+ Service → Postgres** (nome `db`, defina a senha).
> 2. **+ Service → App** → Source: GitHub (repo e branch `main`) → Build: **Dockerfile**.
> 3. Em **Environment** do app, cole:
>    ```
>    NODE_ENV=production
>    PORT=5192
>    DATABASE_URL=postgres://postgres:SUA-SENHA@agendamestre_db:5432/agendamestre
>    ```
>    (host interno = `<projeto>_<serviço>`; confira usuário/nome do banco na aba
>    Credentials do serviço Postgres e ajuste a URL se forem diferentes.)
> 4. Em **Domains & Proxy**, aponte o domínio para a porta **5192**.
5. Clique em **Deploy**. Verifique a saúde em `https://seu-dominio/api/health`.

> **Migrações são automáticas**: no primeiro boot o servidor cria todas as
> tabelas no Postgres (schema idempotente) — não há passo manual de migração.
> As integrações (Groq, Resend, Evolution, Google) são opcionais: deixe as
> chaves vazias (ou remova as linhas) para desligá-las — com placeholders
> tipo `SUA-CHAVE-...` preenchidos, o app acha que estão configuradas e os
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

## 4. Atualizações

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
