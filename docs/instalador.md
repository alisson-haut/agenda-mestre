# Instalador — o contrato de instalação do AgendaMestre

`installer/index.html` é uma página ÚNICA (CSS/JS embutidos, zero requests —
funciona por file://) que gera o JSON **Create from Schema** do EasyPanel com
os 3 serviços (db + minio + app) e todas as envs, incluindo senhas geradas no
navegador. Instalação de produção validada por esse caminho em 06/08/2026.

## REGRA INEGOCIÁVEL (vale para TODA feature futura)

> **O instalador é parte do contrato de deploy.** Qualquer mudança que afete a
> instalação — env nova, serviço novo, porta, volume, imagem, comportamento de
> boot — SÓ está completa quando refletida em TODOS estes lugares, no MESMO
> commit:
>
> 1. `installer/index.html` — campo na UI (se o usuário decide) OU linha no
>    `buildSchema()`/ficha (se é derivado/fixo);
> 2. `easypanel.json` — o exemplo canônico com placeholders;
> 3. `docker-compose.yml` — a alternativa sem EasyPanel;
> 4. `.env.example` + tabela de envs do `DEPLOY.md`;
> 5. O boot do servidor precisa continuar **100% automático e tolerante a
>    ordem** (migração idempotente no SCHEMA, recurso criado sozinho com
>    retry, 503 claro quando opcional ausente — NUNCA um passo manual novo).
>
> Feature que exige passo manual de instalação = feature incompleta.

## Como o gerador funciona (para quem vai mexer nele)

Tudo vive em `installer/index.html` (monolito de propósito: o painel de
preview e vários contextos não carregam subrecursos em file://). Scripts
CLÁSSICOS — nada de `type=module`/`fetch()`/CDN. Peças principais (no
`<script>` do final):

- `randToken(len, alfabeto)` — `crypto.getRandomValues` com rejection
  sampling (sem viés de módulo). `genCredentials()` preenche pg/minio.
- `validadores` — regexes do schema oficial do EasyPanel
  (`easypanel-io/templates/utils/schema.ts`): projeto/serviço `^[a-z0-9-_]+$`,
  database/user `^[a-zA-Z][a-zA-Z0-9_]{0,62}$`, hostname rígido p/ domínios.
- `lerEstado()` → `buildSchema(s)` — monta OBJETO JS e `JSON.stringify`;
  o `env` de cada serviço é array de pares `[K, V]` com **filtro de vazios**
  + `join("\n")`. NUNCA emitir placeholder: linha ausente = recurso desligado
  com aviso limpo; placeholder falso passa nos gates de truthiness do servidor
  e quebra com erro de autenticação.
- `buildSheet(s)` — ficha .txt com credenciais + checklist pós-instalação.
- Saída ao vivo com debounce; botões desabilitados com campo inválido.

### Checklist: adicionar uma ENV nova ao produto

1. Servidor lê a env com default sensato/503 claro (padrão `transcribe.ts`).
2. `installer/index.html`: input na seção certa (integração colapsável ou
   Avançado) + par no array `pares` de `buildSchema` + linha na ficha se for
   credencial + validador se tiver formato.
3. `easypanel.json` (placeholder), `docker-compose.yml` (`${VAR:-}`),
   `.env.example`, tabela do `DEPLOY.md`.
4. Se a env nasce de geração aleatória: gerar em `genCredentials()` e SEMPRE
   incluir na ficha.

### Checklist: adicionar um SERVIÇO novo (ex.: um Redis)

1. Confirmar o formato no repo `easypanel-io/templates` (tipos em
   `utils/schema.ts`; para serviço por imagem: `source:{type:"image"}`,
   comando em `deploy.command`, `mounts` de volume, `domains: []` = interno).
2. `buildSchema`: empurrar o serviço ANTES do app; host interno
   `<projeto>_<serviço>` com PORTA EXPLÍCITA nas envs do app.
3. Espelhar no `docker-compose.yml` (com healthcheck) e no `easypanel.json`.
4. Boot do app: o recurso precisa nascer sozinho (create-if-missing com
   retry persistente — ver `initStorage` em `server/files/storage.ts` e o
   retry do Postgres em `server/db.ts` como moldes).
5. DEPLOY.md: fallback manual pela UI (padrão da seção do MinIO).

## Fatos do formato (pesquisados no repo oficial — não rechutar)

- `type:"postgres"` aceita `user` e `databaseName`; os defaults do painel são
  `postgres` e o nome do projeto — emitimos explícito com os MESMOS valores
  (determinístico em qualquer versão).
- `proxy` NÃO existe no schema (o painel ignora); a porta vai em cada
  `domains[].port`.
- `databaseName` não aceita `-` → o gerador troca por `_` e avisa.
- Caminho na UI: projeto → **Templates → developer → Create from Schema**.

## O que o boot automático já cobre (não regredir)

Migrações idempotentes (array SCHEMA) · espera do Postgres (~2min de retry) ·
bucket MinIO criado com re-tentativas até nascer (60s) e singleton que não
cacheia falha · worker de notificações · varredura de órfãos · remetente
no-reply derivado do RESEND_FROM. O que continua manual (avisado na página e
na ficha): DNS, verificação do domínio no Resend, credenciais Google OAuth,
servidor Evolution próprio.
