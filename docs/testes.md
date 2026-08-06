# Testes (Playwright e2e)

```bash
npm run test:e2e                                   # suíte completa
npx playwright test --project=desktop -g "trecho"  # um teste/projeto
npx playwright show-trace test-results/<pasta>/trace.zip
```

Config (`playwright.config.ts`): baseURL 5192, projetos **desktop** e
**mobile (Pixel 7)** rodam os MESMOS testes; `webServer` sobe `npm run dev` se
não estiver rodando; `workers: 2` + `retries: 1` — a máquina de dev roda tudo
junto (Vite+API+PGlite de 1 conexão) e mais paralelismo gera flake ambiental,
não bug. Falha 2x seguidas = problema real. O projeto desktop roda com
`--use-fake-{ui,device}-for-media-stream` (câmera/mic falsos, sem prompt).

## Padrões (seguir ao escrever teste novo)

- **Conta nova por teste** (`novoEmail()` + `criarConta(page, email)`) —
  isolamento total, sem fixtures de banco.
- Helpers por spec: `abrirNovaTarefa` clica no `.fab` (mobile: botão redondo;
  web: aba recolhida na lateral direita — o clique já expande) e escolhe
  "Nova tarefa" no `.quick-menu`; logout via `.avatar` → menuitem Sair.
- **Nada de rede externa**: fluxos de WhatsApp/e-mail usam `page.route` com
  mocks sequenciais (ver `alerts.spec.ts`: pending → qr(PNG 1×1 embutido) →
  connected). O teste de degradação verifica que a UI sobrevive a 503.
- Teste de alerta: tarefa com `#tDate/#tTime` = agora e `#tRemind=0` dispara
  o modal em segundos (o motor re-checa após todo mutate); persistência de ack
  é provada com reload.
- Auto-save é debounced 600ms → `waitForTimeout(1500)` antes de reload.
- Inputs com filtro (ex.: número WhatsApp) têm `maxLength` — não digitar mais
  caracteres do que cabem no teste.

## Mapa dos specs

| Spec | Cobre |
|---|---|
| `agenda.spec.ts` | registro/login/logout, senha errada, criar tarefa + persistência, troca de senha, ditado presente, 4 etiquetas máx |
| `alerts.spec.ts` | modal de alerta (dispara/ack persiste/snooze/prioridade), lembrete exige hora, settings de notificação (mock), fluxo QR (mock) |
| `auth-reset.spec.ts` | recuperação de senha completa via devLink, uso único, rate limit do forgot, botão Google desabilitado |
| `notes.spec.ts` | criar nota → chip no mês → reabrir pelo chip, persistência, foto (upload real p/ storage), gerar tarefa com vínculo |
| `contacts.spec.ts` | CRUD de contato, download do modelo CSV, import (aspas/linha inválida), vínculo nota↔contato |
| `secrets.spec.ts` | setup do cofre, item com campo secreto, trava ao fechar, senha errada/certa, copiar, zero-knowledge (servidor sem plaintext), rate limit do unlock |

Observações dos specs novos: a derivação PBKDF2 (600k) leva ~0,3–3s — asserts
do cofre usam timeout 20s; upload de foto usa `setInputFiles` no input oculto
(mesmo caminho do picker); "Nova nota"/"Nova tarefa" não colidem no matcher
por nome.

## Worker de mensageria (teste manual, sem Playwright)

1. `.env.local`: `NOTIFY_TICK_MS=5000` e reinicie o dev.
2. Ative um canal em Configurações→Notificações; crie tarefa com hora=agora e
   lembrete "Na hora".
3. Acompanhe `GET /api/notify/log` (status pending→sent/failed, attempts,
   last_error) e o console do server (`notificação falhou`, `outbox:`).
4. Caminhos: concluir a tarefa antes do horário → `canceled`; sem provider →
   3 tentativas com backoff → `failed`; limites → `adiado: ...` sem consumir
   tentativa.
