# Motor de Mensageria do AgendaMestre

E-mail (Resend) e WhatsApp (Evolution GO v3) com fila persistida, dedupe e
defesa em profundidade contra disparos desenfreados. Os lembretes de tarefa
são apenas o **primeiro cliente** do motor — qualquer recurso do sistema pode
enfileirar mensagens.

## Arquitetura

```
recurso do sistema ──> enqueue()  (server/notify/outbox.ts)
                          │  dedupe_key único · teto de fila por usuário
                          ▼
                   notification_log  (fila persistida no Postgres)
                          │
   worker tick 45s ───────┤  (server/notify/worker.ts — produtor de lembretes
                          │   + chamada do despachante)
                          ▼
                   dispatchDue()  (outbox.ts)
                     ├─ expiração de janela (lembrete 10min · demais 24h)
                     ├─ claim atômico (LIMIT por canal por tick)
                     ├─ portões de limite (adiam SEM consumir tentativa)
                     ├─ circuit breaker por canal
                     ├─ adapters: resend.ts · evolution.ts
                     └─ sent / retry (1min, 2min, máx 3) / failed
```

## Como enfileirar de outro recurso

```ts
import { enqueue } from './notify/outbox.js';

await enqueue({
  userId,
  channel: 'whatsapp',            // ou 'email'
  kind: 'resumo_diario',          // categoria sua (≠ 'lembrete')
  fireAt: new Date(),             // quando enviar
  recipient: '5541999999999',     // e-mails separados por vírgula no canal email
  subject: '...',                 // só e-mail
  body: texto,                    // texto (whatsapp) | HTML (email)
  dedupeKey: `resumo:${userId}:${dataYMD}`, // idempotência — obrigatório
});
```

Regras do `kind`: mensagens `kind='lembrete'` expiram 10 min após `fire_at`
(um lembrete atrasado não serve); os demais kinds ganham **24h** de janela.
A reconciliação automática do produtor só toca em `kind='lembrete'` — as
mensagens de outros recursos nunca são canceladas por ela.

## Camadas de proteção (por que nenhum bug dispara sem freio)

| # | Camada | Efeito |
|---|--------|--------|
| 1 | `dedupe_key` UNIQUE | a mesma mensagem nunca sai duas vezes; re-enfileirar só atualiza enquanto `pending`. Nos lembretes, o **minuto do disparo entra na chave** — mudar hora/lembrete da tarefa re-arma a notificação no novo horário (a pendente antiga é cancelada pela reconciliação) |
| 2 | Teto de fila (`NOTIFY_PENDING_MAX`, 60) | produtor bugado não acumula fila infinita — excedente é descartado com log |
| 3 | Cap por tick/canal (`NOTIFY_TICK_CHANNEL_MAX`, 10) | vazão máxima absoluta: 10 por canal a cada 45s |
| 4 | Janela deslizante por usuário | WhatsApp 6/min · e-mail 10/min — excedente é **adiado** (sem consumir tentativa) |
| 5 | Teto diário por usuário | WhatsApp 250/24h · e-mail 80/24h |
| 6 | Teto GLOBAL de e-mail (`NOTIFY_EMAIL_GLOBAL_CAP`, 95) | nunca estoura a cota do Resend (free = 100/dia) |
| 7 | Espaçamento WhatsApp (`NOTIFY_WA_GAP_MS`, 1500) | envios com pausa entre si — padrão humano, reduz risco de bloqueio do número |
| 8 | Circuit breaker | 5 falhas seguidas do provedor → canal pausa 5 min (não martela API caída) |
| 9 | Expiração de janela | atrasado demais → `canceled` com motivo; nunca rajada tardia no boot |

Diagnóstico: `GET /api/notify/log` (30 últimos envios do usuário, com
status/tentativas/erro) e os logs do servidor (`notificação falhou`,
`outbox: circuito ... aberto`, `outbox: fila pendente cheia`).

## Variáveis de ambiente

| Variável | Padrão | O quê |
|---|---|---|
| `NOTIFY_TICK_MS` | 45000 | intervalo do worker |
| `NOTIFY_TICK_CHANNEL_MAX` | 10 | envios por canal por tick |
| `NOTIFY_WA_WINDOW_MAX` | 6 | WhatsApps por usuário por minuto |
| `NOTIFY_WA_DAILY_CAP` | 250 | WhatsApps por usuário por 24h |
| `NOTIFY_WA_GAP_MS` | 1500 | pausa entre WhatsApps consecutivos |
| `NOTIFY_EMAIL_WINDOW_MAX` | 10 | e-mails por usuário por minuto |
| `NOTIFY_EMAIL_DAILY_CAP` | 80 | e-mails por usuário por 24h |
| `NOTIFY_EMAIL_GLOBAL_CAP` | 95 | e-mails de TODO o sistema por 24h |
| `NOTIFY_PENDING_MAX` | 60 | fila pendente máxima por usuário+canal |
| `NOTIFY_DISABLED` | — | `1` desliga o worker |

Aumente os tetos de e-mail conforme o plano do Resend; os de WhatsApp são
conservadores de propósito — número novo enviando rajadas é o padrão clássico
de bloqueio pelo WhatsApp.

## Particularidades do Evolution GO (aprendidas em produção)

- Capitalização das chaves varia por endpoint (`qrcode/code` vs
  `Connected/LoggedIn`) — os leitores toleram as duas.
- `connect {immediate:false}` NÃO gera QR e pode derrubar sessão ativa;
  usar sempre `immediate:true`.
- O QR fica pronto imediatamente após `POST /instance/create`.
- Cada sessão tem orçamento de **5 QRs (~100s)** — esgotou, só recriando a
  instância (o endpoint `/api/notify/whatsapp/connect` escala sozinho:
  logada → QR pronto → revive → recriar).
