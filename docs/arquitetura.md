# Arquitetura

## Pastas

```
client/src/
  api.ts                cliente HTTP tipado (req helper + ApiError)
  App.tsx               gate de auth (loading → AuthPage → AgendaApp)
  auth/AuthPage.tsx     login/registro
  agenda/               todo o app logado
    AgendaApp.tsx       orquestrador: store, navegação, folha, drag, atalhos
    Views.tsx           MonthView, MiniMonth, TimeGrid, Pill, CatIcon, NoteChip
    TaskModal/CatModal/ConfigModal/WhatsAppModal/AlertModal.tsx
    NoteModal.tsx       nota: ditado, links, contatos, mídia com progresso
    ContactsModal.tsx   contatos: lista⇄form + import CSV
    SecretsModal.tsx    cofre: setup/locked/unlocked, auto-lock 2min
    secretsCrypto.ts    PBKDF2 600k + HKDF → AES-GCM (WebCrypto, zero-knowledge)
    CameraCapture.tsx   câmera fullscreen (foto/conjunto/vídeo — desktop)
    AudioRecorder.tsx   gravador de áudio p/ nota (irmão do Dictation)
    useAlerts.ts        motor de alertas in-app (ack/snooze em prefs.alerts)
    sound.ts            WebAudio (sem arquivos de áudio)
    Dictation.tsx       ditado por voz (Groq)
    logic.ts            visible/byDay/notesByDay/repDate/layoutOverlaps
    dates.ts            re-exporta shared/dates + constantes de UI (MESES...)
    types.ts            Task/Cat/Note/Contact/Prefs/DEFAULT_PREFS/taskCats
    seed.ts             PRESETS de etiquetas + tarefas de exemplo
server/
  index.ts              Express, static em prod, monta rotas, inicia worker
  env.ts                carrega .env.local/.env (roda primeiro)
  db.ts                 adapter pg/PGlite + array SCHEMA (migração no boot)
  auth.ts               sessões cookie httpOnly, bcrypt, limited() (rate limit)
  state.ts              GET/PUT /api/state (full-state sync ⇄ tabelas)
  notes.ts              CRUD de notas + varredura de note_files órfãos
  contacts.ts           CRUD de contatos + modelo/import CSV (parser próprio)
  secrets.ts            cofre zero-knowledge (unlock token 2min, rekey, reset)
  files/                mídia das notas
    storage.ts (adapter+init) · storage-minio.ts · storage-fs.ts (dev)
    routes.ts (upload streaming, download com Range, quota)
  transcribe.ts         proxy de áudio → Groq Whisper
  notify/               notificações (ver docs/mensageria.md)
    worker.ts (produtor de lembretes) · outbox.ts (fila+limites+despacho)
    routes.ts (settings/QR/testes/log) · evolution.ts · resend.ts
    templates.ts · tz.ts · auth-emails.ts (reset de senha)
shared/                 dates.ts + recurrence.ts (client E server importam)
e2e/                    agenda · alerts · auth-reset · notes · contacts · secrets
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
5. **Notas e contatos ficam FORA do full-state**: o boot faz
   `listNotes/listContacts` em paralelo (o calendário precisa das notas no 1º
   paint) e cada mutação chama a rota própria com atualização otimista local.
   A mídia de nota sobe ANTES do save (id de nota gerado no cliente) por
   `/api/files` em streaming, e é servida pelo mesmo proxy autenticado — o
   navegador nunca fala com o MinIO.
6. **Secrets**: a senha-mestra nunca sai do navegador — o cliente deriva a
   chave (PBKDF2 600k + HKDF), cifra cada item (AES-256-GCM) e manda só
   ciphertext + um authKey de verificação; o unlock devolve um token de 2min
   usado nos writes. Detalhes em docs/backend.md.

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
| password_resets | id | token de recuperação: token_hash UNIQUE, 30min, uso único (used_at) |
| contacts | (user_id,id) | name, phone, email, company, notes, avatar (data URL ≤160k) |
| notes | (user_id,id) | title, descr, date (dia de criação), links/contact_ids JSONB, task_id FROUXO |
| note_files | (user_id,id) | note_id SEM FK (upload antes do save), kind/mime/ext/name/size — objeto no storage |
| secrets_vault | user_id | bcrypt(authKey), salt, iterations — verificador do cofre (zero-knowledge) |
| secrets_items | (user_id,id) | ciphertext + iv opacos (título/segmento DENTRO do ciphertext) |

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
- **Entidades novas (notas/contatos/secrets) em CRUD próprio**, não no
  full-state: mídia e ciphertext não podem viajar num PUT que apaga/reinsere
  tudo, e o payload cresceria sem limite. A regra "caminho de escrita único"
  continua valendo APENAS para tasks/cats.
- **Vínculos frouxos por design**: `notes.task_id`/`notes.contact_ids` sem FK
  (o PUT full-state recria tasks; contato excluído não trava nota) e
  `note_files` sem FK para notes (upload antes do save; órfãos >24h varridos).
  Dangling é filtrado na exibição, nunca é erro.
- **Mídia atrás de proxy autenticado** (nunca presigned/URL direta do MinIO):
  CSP continua `'self'`, credenciais só no servidor, autorização por sessão em
  todo GET — o custo de banda passa pelo app, aceitável na escala atual.
- **Cofre zero-knowledge com senha-mestra SEPARADA da conta** (decisão do
  dono): esquecer = perder os itens (avisado no setup); reset de senha da
  conta não toca o cofre; contas Google (senha aleatória) funcionam.
