# Frontend — padrões do client

## Store mutável (o padrão central — não "reactificar")

`AgendaApp.tsx` guarda `dataRef.current = {tasks, cats, prefs}` **mutável**.
Toda alteração passa por `mutate(fn)`: executa `fn(data)` mutando direto,
agenda auto-save debounced e faz bump (re-render). Handlers seguem o original
imperativo (port fiel do HTML de referência). Não converter para immutable/
reducer — o drag&drop e os undos dependem de referências estáveis de objeto
(ex.: toast "Desfazer" captura o objeto tarefa e o restaura por referência).

Cuidado clássico: **cliques em rajada** — handlers que leem estado do render
para decidir um `setState` devem usar update funcional (ver `toggleCat` no
TaskModal, que já quebrou uma vez por isso).

## Checklist: adicionar um campo à tarefa (round-trip completo)

1. `client/src/agenda/types.ts` — campo em `Task`.
2. `client/src/agenda/seed.ts` — valor nas tarefas de exemplo.
3. `normalizeTask` em `AgendaApp.tsx` — default para dados antigos.
4. `TaskModal.tsx` — estado + reset no effect de `p.session` + input + payload
   em `doSave` + `TaskPayload`.
5. `server/state.ts` — `cleanTask` (validação), SELECT do GET, INSERT do PUT
   (atenção à numeração `$n`).
6. `server/db.ts` — `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS ...` no SCHEMA.
7. Se o worker usa o campo: SELECT do produtor em `server/notify/worker.ts`.
8. e2e se houver UI nova.
Pular o passo 1 faz o próximo PUT **zerar o campo no banco** (sync full-state).

## Modais

Padrão: overlay sempre montado, classe `open` controla; estado
`{open, session, ...}` — `session` incrementa a cada abertura e o modal reseta
o formulário num effect com dep `[p.session]`. Fechar por clique no backdrop ou
`[data-close]`. Empilhar modais é ok (CatModal sobre TaskModal; WhatsAppModal
sobre ConfigModal). `AlertModal` é o único com overlay próprio (`.alert-overlay`,
z-index 500, sem clique-fora-fecha; Escape = prorrogar 10min via keyRef).

## Notas, Contatos e Secrets (modais do acesso rápido)

Entidades **fora do full-state**: `notes`/`contacts` são `useState` normais no
AgendaApp, carregados no boot (`api.listNotes/listContacts`, silencioso) e
mutados por operação (create/update/delete na API + atualização otimista).
`NoteModal`/`ContactsModal`/`SecretsModal` seguem o padrão session/open, com
três regras extras:
- **Dictation monta só quando `p.open`** ({p.open && <Dictation/>}) — o e2e
  conta `.dict-btn` e os modais ficam sempre montados.
- **Escape é topo-primeiro** no keyRef (câmera → secrets → contacts → note →
  resto); os três entram no guard de atalhos e no `alerts.suspended()`.
- Id de NOTA NOVA nasce na abertura do modal (`uid()`), porque a mídia sobe
  ANTES do save (`api.uploadNoteFile` com progresso; entradas `sending/ok/err`
  em `media`; salvar bloqueia com envio pendente).
Chips no calendário: `ctx.notes` + `notesByDay` (logic.ts) → `.note-chip`
(mês, conta no maxPills), `.note-strip` (faixa sem-hora), `.dot.note`
(trimestre/tira) e `.mini-day.has-note` (ano) — todos `[data-open-note]`,
tratado no `viewportClick` ANTES da célula genérica; sem `data-drag` (inertes
ao arrasto). Token de cor `--note` (âmbar). "Gerar tarefa" salva a nota, abre
`openNew({date, title, notes})` e o `saveTask` grava o `taskId` de volta
(`pendingNoteTask` ref). Captura: `CameraCapture` (overlay próprio z-300,
desktop `hoverable`; Escape fecha SÓ ela via capture phase) e `AudioRecorder`
(irmão do Dictation, sem transcrição); mobile usa `<input capture>` nativo.
SecretsModal: cripto em `secretsCrypto.ts`, `encKey` SÓ em `useRef`, trava ao
fechar e por inatividade (2min, badge `.lock-badge`).

## Delegação de eventos e atributos-contrato

Viewport e lateral usam UM onClick com `closest()` sobre atributos de dados:
`data-act` (toggle/add/addsel/clearsel/togglecat/editcat), `data-openday`,
`data-openmonth`, `data-day`, `data-slot`+`data-min`, `data-drop-day`,
`data-drop-nodate`, `data-drag`+`data-id`+`data-dk`. O drag&drop (pointer
handlers no document, ghost por clone de DOM) e o click usam esses atributos —
renomear quebra funcionalidades silenciosamente.

Ids imperativos usados por código: `#viewport`, `#tgWrap`, `#side`,
`#btnNewSheet`. Ids usados pelos e2e: `#tTitle #tDate #tTime #tDur #tRemind
#aEmail #aPass #cfgCur #cfgNew #cfgNew2 #cfgSound #cfgWaNum`, os dos modais
novos (`#noteDlg #nTitle #nBody · #contactsDlg #ctName #ctPhone #ctEmail
#ctCompany #ctNotes · #secretsDlg #sMaster #sMaster2 #sTitle #sSegment` —
`#cName` é do CatModal, por isso o prefixo `ct`) e classes `.avatar .views
.pill-title .catic .dict-btn .alert-overlay .wa-qrbox .note-chip .quick-menu
.contact-row .secret-card .lock-badge`. Novo atributo de delegação:
`data-open-note`.

## Comportamentos imperativos (fora do React)

- **Folha mobile** (3 alturas peek/mid/full): estilos via `--sy` no elemento,
  medidas em refs, gestos no grip. Desktop ignora (CSS ≥900px).
- **Swipe** de período no viewport (touch), **animação** de navegação por
  classe `go-l/go-r` reaplicada com reflow.
- **Alertas**: `useAlerts` checa a cada 20s + após todo render + visibilitychange;
  tolerância de 15min; um modal por vez (fila por prioridade). Som em
  `sound.ts` — o unlock acontece no primeiro pointerdown global.

## CSS

Tokens em `:root[data-theme=light|dark]` — **paleta oficial da marca**: dark
Carvão #0B0F12 + Verde Mestre #00E09A (com `--on-brand` ESCURO #04231C);
light Branco Suave #F2F4F7 + Verde Profundo #0A7F64 (#00E09A no light é SÓ
decorativo — contraste). Fontes **Sora** (display: títulos/logo/números),
**Inter** (UI) e **JetBrains Mono** (horários/rótulos). Isotipo/wordmark em
`client/src/brand/Logo.tsx` (LogoMark/BrandWordmark); favicon/icon em
`client/public/`. **Auth/splash/reset são SEMPRE dark** (App.tsx força;
AgendaApp restaura a pref do usuário); tema padrão de usuário novo = dark.
Breakpoint único mobile≤899 / desktop≥900. Topbar é UMA linha no desktop (views como segmentado
dentro do `.top-row`; no mobile o `.views` quebra para a 2ª linha via
flex-wrap + order). Lateral usa `.pill.lst` (duas linhas: hora+título / meta
com "Nd atrasada"/contadores). Cores de etiqueta via `--c` →
`--cc` (dark clareia com color-mix). `CatIcon`/`.catic` é o ícone de etiqueta
(imagem ou cor) — tamanhos por contexto. Célula do mês no mobile mostra só a
etiqueta principal; desktop mostra todas com sobreposição.
