# AgendaMestre

Organizador de tarefas e calendário **mobile-first** — visões de dia, semana, mês,
trimestre e ano; etiquetas coloridas, recorrência, subtarefas, arrastar-e-soltar,
tema claro/escuro, busca e **ditado por voz** (transcrição via Groq Whisper).
Interface em português, no estilo "papel e tinta".

Além das tarefas, o menu de acesso rápido traz:
- **Notas** com fotos pela câmera, gravação de áudio e vídeo, anexos, links e
  vínculo com contatos — marcadas no calendário no dia de criação e capazes de
  **gerar uma tarefa agendada**; as mídias vivem num **MinIO/S3** próprio
  (proxy autenticado, separação por usuário, cotas).
- **Contatos** com cadastro básico e **import CSV** (modelo baixável).
- **Secrets** — cofre de logins e senhas **zero-knowledge**: criptografia
  AES-256-GCM no navegador com senha-mestra própria (PBKDF2 600k), auto-trava
  em 2 minutos; o servidor só guarda ciphertext.

Menu de perfil no topo (avatar) com **Configurações** — edição de nome, início da
semana e troca de senha — e **Sair**. O ditado por voz fica nos campos de nome e
anotações da tarefa: gravação com contador e barras de pico, botão de parar e
transcrição automática (defina `GROQ_API_KEY`, veja `.env.example`).

**Lembretes e notificações**: cada tarefa pode ter um lembrete (na hora até 1 dia
antes). No horário, o app aberto mostra um **modal de alerta** com som, estilizado
pela prioridade, com ações rápidas (Vou iniciar · Prorrogar · Mudar data ·
Cancelar) — e um **worker interno** dispara **e-mail via Resend** e **WhatsApp via
Evolution GO** (remetente vinculado por QR code nas Configurações), com fila
persistida, dedupe por ocorrência e retry. Veja [DEPLOY.md](DEPLOY.md) para as
variáveis (`RESEND_API_KEY`, `EVOLUTION_BASE_URL`, ...).

## Stack

| Camada | Tecnologia |
| --- | --- |
| Front | React 18 + TypeScript + Vite |
| API | Express + TypeScript (Node 22) |
| Banco | PostgreSQL (produção) · PGlite embutido no dev — zero instalação |
| Arquivos | MinIO/S3 (produção) · disco local no dev — proxy autenticado, nunca exposto |
| Auth | Sessões httpOnly + bcrypt (simples e seguro) |
| Testes | Playwright (desktop + mobile) |
| Deploy | Docker · EasyPanel (VPS Hostinger) · DNS Cloudflare |

## Rodando localmente

```bash
npm install
npm run dev
```

Abra **http://localhost:5192**. A API roda em 5193 (proxy `/api`); os dados ficam
em `.data/pglite` (Postgres embutido) — nada para instalar.

Para testar o ditado por voz, cole sua chave da Groq em **`.env.local`**
(`GROQ_API_KEY=...`, crie em https://console.groq.com/keys) e reinicie o
`npm run dev`. O arquivo é ignorado pelo git.

## Testes e2e (Playwright)

```bash
npx playwright install chromium
npm run test:e2e
```

Os testes cobrem: criação de conta, login/logout, senha errada, criação de tarefa
e persistência após recarregar — em viewport desktop e mobile (Pixel 7).

## Build de produção

```bash
npm run build     # gera dist/ (front) e dist-server/ (API)
npm run preview   # build + roda com NODE_ENV=production (front + API na 5192)
```

Em produção use `NODE_ENV=production` e `DATABASE_URL` apontando para um
Postgres — sem `NODE_ENV=production` o processo sobe só a API (porta 5193)
e não serve o front. As tabelas são criadas automaticamente no primeiro boot.

## Deploy

Guia completo em [DEPLOY.md](DEPLOY.md) — EasyPanel via [`easypanel.json`](easypanel.json),
`docker-compose.yml` como alternativa e passo a passo do DNS no Cloudflare.

## Documentação

- [CLAUDE.md](CLAUDE.md) — contexto para sessões de agente (regras + mapa)
- [docs/arquitetura.md](docs/arquitetura.md) · [docs/frontend.md](docs/frontend.md) · [docs/backend.md](docs/backend.md)
- [docs/mensageria.md](docs/mensageria.md) — motor de e-mail/WhatsApp e rate limits
- [docs/integracoes.md](docs/integracoes.md) — Groq, Evolution GO, Resend
- [docs/testes.md](docs/testes.md) — Playwright: padrões e mapa dos specs

## Estrutura

```
client/          React (views do calendário, folha de tarefas, modais, auth)
server/          Express (auth, estado, adaptador pg/PGlite)
e2e/             Testes Playwright
Dockerfile       Build multi-stage (imagem final só com deps de produção)
easypanel.json   Schema de instalação no EasyPanel
```
