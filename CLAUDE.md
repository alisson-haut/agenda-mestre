# AgendaMestre — contexto para sessões de agente

App de agenda/tarefas mobile-first em PT-BR (design "papel e tinta"), com
lembretes in-app (modal+som), notificações por e-mail (Resend) e WhatsApp
(Evolution GO v3), notas com mídia (fotos/vídeo/áudio no MinIO), contatos
(CSV) e cofre Secrets zero-knowledge. Multi-usuário com auth por sessão.

## Stack e portas

React 18 + TS + Vite (`client/`) · Express + TS (`server/`) · Postgres em
produção (`DATABASE_URL`) e **PGlite embutido no dev** (`.data/pglite`) ·
código puro compartilhado em `shared/` · Playwright (`e2e/`).

Dev: `npm run dev` → web em **5192** (proxy `/api`) + API em 5193.
Produção: um processo na 5192 (Docker/EasyPanel). Envs locais: `.env.local`
(git-ignorado, carregado por `server/env.ts` no boot — reiniciar após editar).

## Comandos

```bash
npm run dev          # subir local (5192)
npx tsc --noEmit     # typecheck (client+server+shared)
npm run test:e2e     # suíte Playwright (precisa do dev rodando ou sobe sozinha)
npm run build        # dist/ (front) + dist-server/ (API bundle)
```

## Regras inegociáveis

1. **Nunca edite arquivos via PowerShell** (corrompe UTF-8/acentos). Use as
   ferramentas Write/Edit. PowerShell só para comandos.
2. **PGlite = 1 conexão**: nenhuma transação pode envolver I/O de rede;
   statements de claim/update são únicos e atômicos (ver `server/notify/outbox.ts`).
3. **Migração de schema** só acrescentando statements idempotentes
   (`CREATE/ALTER ... IF NOT EXISTS`) ao array `SCHEMA` em `server/db.ts`.
4. **Estado do cliente é mutável** (`dataRef` + `mutate()` + bump). O sync é
   full-state: `PUT /api/state` substitui TODAS as tasks/cats do usuário —
   campo novo de tarefa exige round-trip completo (checklist em docs/frontend.md).
5. **Novo campo/feature = atualizar e rodar a suíte e2e** (6 specs × 2
   projetos, conta nova por teste). Ids de elementos (`#tTitle`, `#tRemind`,
   `.avatar`, `#nTitle`, `#sMaster`...) são contratos dos testes — não
   renomear sem atualizar `e2e/`.
6. Mensagens/textos da UI em **PT-BR**, tom direto; fontes **Sora (display) +
   Inter (UI) + JetBrains Mono** e paleta oficial (Verde Mestre #00E09A no
   dark com texto escuro; Verde Profundo #0A7F64 no light — #00E09A no light
   é só decorativo). Auth/splash sempre dark.
7. Envio de e-mail/WhatsApp **sempre** pelo outbox (`enqueue()`) — exceção
   única: e-mails TRANSACIONAIS de conta (reset de senha, testes de canal)
   vão direto pelo `sendEmail` com `limited()` próprio.

## Mapa de documentos — leia só o que a tarefa pede

| Vai mexer em... | Leia |
|---|---|
| Visão geral, pastas, schema, decisões e porquês | `docs/arquitetura.md` |
| UI/React: store, modais, drag&drop, alertas, CSS, checklist de campo novo | `docs/frontend.md` |
| API, auth, validação, banco/adapter, env | `docs/backend.md` |
| Motor de e-mail/WhatsApp, fila, rate limits, enqueue p/ novas features | `docs/mensageria.md` |
| Groq (ditado), Evolution GO (pegadinhas!), Resend, DNS | `docs/integracoes.md` |
| Testes: rodar, padrões, mocks, flakiness | `docs/testes.md` |
| Deploy EasyPanel/Cloudflare, envs de produção | `DEPLOY.md` |
