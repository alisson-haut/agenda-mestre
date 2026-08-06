# Arquitetura

## Pastas

```
client/src/
  api.ts                cliente HTTP tipado (req helper + ApiError)
  App.tsx               gate de auth (loading → AuthPage → AgendaApp)
  auth/AuthPage.tsx     login/registro
  agenda/               todo o app logado
    AgendaApp.tsx       orquestrador: store, navegação, folha, drag, atalhos
    Views.tsx           MonthView, MiniMonth, TimeGrid, Pill, CatIcon
    TaskModal/CatModal/ConfigModal/WhatsAppModal/AlertModal.tsx
    useAlerts.ts        motor de alertas in-app (ack/snooze em prefs.alerts)
    sound.ts            WebAudio (sem arquivos de áudio)
    Dictation.tsx       ditado por voz (Groq)
    logic.ts            visible/byDay/repDate/layoutOverlaps (re-exporta occurrences)
    dates.ts            re-exporta shared/dates + constantes de UI (MESES...)
    types.ts            Task/Cat/Prefs/DEFAULT_PREFS/taskCats
    seed.ts             PRESETS de etiquetas + tarefas de exemplo
server/
  index.ts              Express, static em prod, monta rotas, inicia worker
  env.ts                carrega .env.local/.env (roda primeiro)
  db.ts                 adapter pg/PGlite + array SCHEMA (migração no boot)
  auth.ts               sessões cookie httpOnly, bcrypt, limited() (rate limit)
  state.ts              GET/PUT /api/state (full-state sync ⇄ tabelas)
  transcribe.ts         proxy de áudio → Groq Whisper
  notify/               notificações (ver docs/mensageria.md)
    worker.ts (produtor de lembretes) · outbox.ts (fila+limites+despacho)
    routes.ts (settings/QR/testes/log) · evolution.ts · resend.ts
    templates.ts · tz.ts
shared/                 dates.ts + recurrence.ts (client E server importam)
e2e/                    agenda.spec.ts + alerts.spec.ts
```

## Fluxo de dados

1. Login → cookie de sessão (30d) → `GET /api/state` devolve `{cats, tasks, prefs}`.
2. O cliente guarda tudo num objeto **mutável** e re-renderiza por versão
   (bump). Toda mutação agenda um `PUT /api/state` debounced (600ms) com o
   estado inteiro; flush com `keepalive` em pagehide/visibilitychange.
3. O servidor decompõe o PUT em tabelas reais (transação: DELETE + re-INSERT
   de cats/tasks, UPSERT de prefs).
4. O worker de notificações (mesmo processo, tick 45s) lê as tabelas, expande
   recorrências e alimenta a fila `notification_log` → Resend/Evolution.

## Tabelas (schema em server/db.ts)

| Tabela | Chave | Notas |
|---|---|---|
| users | id TEXT | email UNIQUE, bcrypt hash |
| sessions | token_hash | SHA-256 do token do cookie, 30d |
| categories | (user_id,id) | name, color, icon (data URL ≤120k), position |
| tasks | (user_id,id) | date/time TEXT locais, dur, remind, prio, rec/subs/done_dates/cats JSONB, done, created |
| prefs | user_id | JSONB inteiro (view/theme/weekStart/hidden/filter/showDone/soundEnabled/alerts) |
| notify_settings | user_id | emails JSONB, whatsapp_number, *_enabled, wa_instance_name/token, timezone IANA |
| notification_log | id | fila da mensageria: dedupe_key UNIQUE, status, attempts, next_attempt_at, kind |

## Decisões e porquês (não reverter sem motivo forte)

- **Sync full-state** em vez de CRUD por entidade: o app de referência mutava
  estado livremente (drag&drop, subtarefas, doneDates); o PUT único mantém o
  port fiel e simples. Consequência: campo novo exige round-trip completo e
  `notification_log.task_id` **não tem FK** (o PUT apaga/reinsere tasks — uma
  FK CASCADE zeraria a fila a cada save; órfãos são reconciliados pelo worker).
- **PGlite no dev**: zero instalação no Windows do usuário. Mesmo SQL do
  Postgres; limitações na regra 2 do CLAUDE.md.
- **Datas/horas como TEXT locais** (`YYYY-MM-DD`/`HH:MM`) + timezone IANA por
  usuário em notify_settings: o cliente opera em hora local; só o worker
  converte para UTC (`server/notify/tz.ts`, DST-safe via Intl).
- **Instância WhatsApp por usuário** (remetente conectado por QR nas
  Configurações), não uma global do sistema.
- **Ack de alerta em `prefs.alerts`** (`"taskId|dk"` → ack/snooze) viaja no
  sync existente — sem endpoint novo; poda automática >7 dias.
- **Worker no processo do Express** (setInterval), sem broker: escala atual
  não justifica infra extra; o desenho da fila permite extrair depois.
