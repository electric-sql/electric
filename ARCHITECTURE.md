# Electric Sync Service - Architectural Analysis

> Document de referência para a reimplementação experimental do Electric noutro linguagem.
> Baseado na análise do código-fonte do sync-service (Elixir/OTP).

---

## 1. Visão Geral

O Electric é um **sync engine para PostgreSQL** que permite sincronizar subconjuntos de dados ("shapes") de uma base de dados Postgres para clientes (browsers, apps, serviços). A arquitectura segue um modelo de **replicação lógica** do PostgreSQL, processada e servida via HTTP.

### Fluxo de dados principal

```
PostgreSQL WAL (logical replication)
        │
        ▼
┌─────────────────────┐
│  ReplicationClient   │  ← Postgrex.ReplicationConnection
│  (pg logical rep)    │  ← Descodifica mensagens WAL
└─────────┬───────────┘
          │ Relation / TransactionFragment
          ▼
┌─────────────────────┐
│  ShapeLogCollector   │  ← GenServer central
│  - Partitions        │  ← Filtra txns por tabela/shape
│  - EventRouter       │  ← Encaminha para consumidores
│  - DependencyLayers  │  ← Garante ordem entre shapes dependentes
│  - FlushTracker      │  ← Tracking de flush para feedback ao PG
└─────────┬───────────┘
          │ por shape_handle
          ▼
┌─────────────────────┐
│  Consumer (por shape)│  ← GenServer temporário, 1 por shape
│  - Snapshot inicial  │  ← Query PG + escrita storage
│  - Change handling   │  ← Converte changes para log items
│  - Move-in handling  │  ← Subqueries / dependent shapes
│  - Storage writer    │  ← Escreve log + snapshots
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  Storage Backend     │  ← PureFileStorage (SQLite-backed)
│  - Snapshots         │  ← Initial data dump
│  - Log (append-only) │  ← Stream de operações
│  - Chunk boundaries  │  ← Permite paginação eficiente
│  - Compaction        │  ← Limpeza de dados antigos
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  HTTP API (Plug)     │  ← GET/POST/DELETE /v1/shape
│  - ServeShapePlug    │  ← Streaming de respostas
│  - Long-polling      │  ← Para modo live
│  - SSE               │  ← Server-Sent Events (live_sse)
│  - Cache headers     │  ← CDN-friendly caching
└─────────────────────┘
```

---

## 2. API HTTP

### 2.1 Endpoints

| Método   | Path          | Descrição                            |
|----------|---------------|--------------------------------------|
| `GET`    | `/v1/shape`   | Obter dados de uma shape             |
| `POST`   | `/v1/shape`   | Obter dados (subset params no body)  |
| `DELETE` | `/v1/shape`   | Eliminar uma shape                   |
| `OPTIONS`| `/v1/shape`   | CORS preflight                       |
| `GET`    | `/v1/health`  | Health check                         |
| `GET`    | `/`           | Root (retorna 200 vazio)             |

### 2.2 Parâmetros do Request (Query String)

| Parâmetro   | Tipo     | Obrigatório | Descrição                                           |
|-------------|----------|-------------|-----------------------------------------------------|
| `table`     | string   | Sim*        | Nome qualificado da tabela (ex: `public.users`)     |
| `offset`    | string   | Sim         | Posição no log: `-1` (início), `now`, `{tx}_{op}`   |
| `handle`    | string   | Cond.       | Identificador da shape (obrigatório se offset != -1) |
| `live`      | boolean  | Não         | Modo live (long-polling / SSE)                       |
| `live_sse`  | boolean  | Não         | Usar Server-Sent Events em vez de long-polling       |
| `where`     | string   | Não         | Cláusula WHERE para filtrar dados                    |
| `columns`   | string   | Não         | Lista de colunas separadas por vírgula               |
| `replica`   | enum     | Não         | `default` ou `full` (controla conteúdo de deletes/updates) |
| `params`    | JSON     | Não         | Parâmetros para cláusulas WHERE parametrizadas       |
| `secret`    | string   | Cond.       | API secret para autenticação                         |
| `cursor`    | string   | Não         | Cursor de tempo para cache-busting em live mode      |
| `log`       | enum     | Não         | `full` (default) ou `changes_only`                   |

*\*`table` é obrigatório a menos que a API tenha uma shape pré-definida.*

### 2.3 Parâmetros de Subset (via query string prefixada ou POST body)

| Parâmetro   | Tipo     | Descrição                                      |
|-------------|----------|-------------------------------------------------|
| `subset[where]`    | string   | WHERE clause adicional para o subset    |
| `subset[order_by]` | string   | ORDER BY clause                         |
| `subset[limit]`    | integer  | LIMIT                                   |
| `subset[offset]`   | integer  | OFFSET (requer order_by)                |
| `subset[params]`   | JSON/map | Parâmetros para a WHERE clause do subset|

### 2.4 Response Headers

| Header                 | Descrição                                                 |
|------------------------|-----------------------------------------------------------|
| `electric-handle`      | Identificador único da shape                              |
| `electric-offset`      | Offset do fim do chunk actual                             |
| `electric-schema`      | Schema JSON das colunas (apenas em respostas não-live)    |
| `electric-up-to-date`  | Presente quando o cliente está sincronizado               |
| `electric-cursor`      | Timestamp para o próximo pedido live                      |
| `etag`                 | ETag para cache validation (`{handle}:{req_offset}:{resp_offset}`) |
| `cache-control`        | Estratégia de cache (varia por tipo de request)           |
| `retry-after`          | Segundos até retry (em caso de erro 503)                  |
| `content-type`         | `application/json` ou `text/event-stream` (SSE)           |

### 2.5 Status Codes

| Status | Significado                                              |
|--------|----------------------------------------------------------|
| 200    | Sucesso - dados no body                                  |
| 202    | Shape eliminada com sucesso (DELETE)                     |
| 304    | Not Modified (ETag match)                                |
| 400    | Request inválido (parâmetros errados)                    |
| 401    | Não autorizado (secret errado)                           |
| 404    | Shape não encontrada (para DELETE)                       |
| 409    | Conflict - shape foi invalidada, redirecção necessária   |
| 413    | Body demasiado grande                                    |
| 503    | Serviço indisponível / base de dados inacessível / overload |

### 2.6 Estratégia de Cache

A API é desenhada para funcionar atrás de CDNs:

- **offset=-1 (snapshot)**: `max-age=604800, s-maxage=3600, stale-while-revalidate=2629746`
- **Non-live (catch-up)**: `max-age={max_age}, stale-while-revalidate={stale_age}`
- **Live**: `max-age=5, stale-while-revalidate=5`
- **Live SSE**: `max-age={sse_timeout - 1}`
- **409 com handle**: `max-age=60, must-revalidate`
- **4xx/5xx (outros)**: `no-store`

---

## 3. Formato dos Dados (Wire Protocol)

### 3.1 Log Items

O body da resposta é um array JSON (newline-delimited em streaming) de log items:

```json
{
  "key": "\"public\".\"users\"/\"42\"",
  "value": {
    "id": "42",
    "name": "Alice",
    "email": "alice@example.com"
  },
  "headers": {
    "operation": "insert",
    "relation": ["public", "users"],
    "txids": [12345],
    "lsn": "2847364",
    "op_position": 0
  }
}
```

### 3.2 Operações

| Operação  | `key`    | `value`             | `old_value`        | Notas                                |
|-----------|----------|---------------------|--------------------|--------------------------------------|
| `insert`  | PK-based | Record completo     | -                  | Novo record na shape                 |
| `update`  | PK-based | Colunas alteradas + PKs | Só em replica=full | Sem mudança de PK                |
| `delete`  | PK-based | Só PKs (ou full em replica=full) | - | Record removido da shape         |

### 3.3 Key Changes (PK Updates)

Quando a PK muda, um update é convertido em **dois** log items:
1. `delete` do old key (com `key_change_to` header)
2. `insert` do new key (com `key_change_from` header)

### 3.4 Key Format

```
"<schema>"."<table>"/"<pk1>"/"<pk2>"/...
```

Valores de PK são escaped: `/` → `//`, `NULL` → `_`.

### 3.5 Control Messages

```json
{
  "headers": {
    "control": "up-to-date",
    "global_last_seen_lsn": "2847364"
  }
}
```

### 3.6 Replica Modes

- **`default`**: Deletes contêm apenas PKs; updates contêm apenas PKs + colunas alteradas.
- **`full`**: Deletes contêm o record completo; updates contêm `value` (novo) e `old_value` (campos alterados antes da mudança).

### 3.7 Move Tags

Quando uma shape tem subqueries/dependências, os log items podem conter `tags` (array de hashes) e `removed_tags`, usados para tracking de "move-in/move-out" de records entre shapes dependentes.

---

## 4. Log Offset System

### 4.1 Estrutura do LogOffset

```
LogOffset = {tx_offset: int64, op_offset: int | :infinity}
```

- `tx_offset`: LSN do PostgreSQL (posição no WAL), convertido para inteiro de 64-bit.
- `op_offset`: Posição da operação dentro da transação.

### 4.2 Offsets Especiais

| Offset            | Representação String | Significado                               |
|-------------------|---------------------|-------------------------------------------|
| `before_all`      | `-1`                | Antes de tudo (pedir snapshot desde início)|
| `first`           | `0_0`               | Primeiro offset possível                  |
| `last_before_real` | `0_inf`            | Fim do snapshot virtual                   |
| `last`            | `max_inf`           | Último offset possível                    |
| `now`             | `now`               | "Agora" - não pedir dados, só handle+offset |

### 4.3 Chunking

O log é dividido em chunks para:
- Permitir caching granular (cada chunk tem um offset distinto)
- Limitar o tamanho das respostas
- O `chunk_bytes_threshold` (default ~50KB) controla quando criar um novo chunk boundary
- `get_chunk_end_log_offset(offset)` retorna o fim do chunk para um dado offset

### 4.4 Fluxo de Offsets no Request

1. Cliente envia `offset=-1` → recebe snapshot + primeiro `chunk_end_offset`
2. Cliente envia `offset={chunk_end_offset}&handle={handle}` → recebe próximo chunk
3. Quando recebe `up-to-date` → pode mudar para `live=true`
4. Em live mode, se não há mudanças → long-poll com timeout → retorna `up-to-date`

---

## 5. Shape System

### 5.1 Shape Definition

Uma Shape é definida por:

```
Shape {
  root_table: {schema, table_name}     # ex: {"public", "users"}
  root_table_id: integer               # OID do PostgreSQL
  root_pk: [string]                    # Colunas da primary key
  root_column_count: integer           # Total de colunas na tabela
  where: Expr | nil                    # Expressão WHERE compilada
  selected_columns: [string]           # Colunas incluídas
  explicitly_selected_columns: [string]# Colunas pedidas pelo utilizador
  replica: :default | :full            # Modo de réplica
  flags: %{flag => boolean}            # selects_all_columns, selects_generated_columns, etc
  storage: %{compaction: :enabled | :disabled}
  log_mode: :full | :changes_only
  shape_dependencies: [Shape]          # Subqueries / dependent shapes
}
```

### 5.2 Shape Handle

- Formato: `{hash}-{microsecond_timestamp}`
- O `hash` é `phash2` da representação comparable da shape
- Identifica univocamente uma instância de shape
- Usado como cache-buster: se a shape é invalidada, novo handle é gerado

### 5.3 Shape Lifecycle

```
1. Pedido HTTP com offset=-1, table=X
   │
   ├─ ShapeCache.get_or_create_shape_handle(shape_def)
   │   ├─ ETS lookup por shape comparable (fast path)
   │   └─ GenServer call para criar (slow path, serializado)
   │
   ├─ Se nova shape:
   │   ├─ ShapeStatus.add_shape() → regista na ETS
   │   ├─ Inicia Consumer GenServer
   │   ├─ Consumer pede snapshot ao PG (query completa)
   │   ├─ Regista no ShapeLogCollector para receber txns
   │   └─ Snapshot escrito no Storage
   │
   └─ Retorna (shape_handle, last_offset)

2. Pedidos subsequentes (offset != -1)
   │
   ├─ Valida handle vs shape definition (hash check rápido)
   ├─ Lê log desde offset até chunk_end no Storage
   └─ Retorna dados + next offset

3. Live mode
   │
   ├─ Regista listener para eventos da shape
   ├─ Long-poll: bloqueia até nova mudança ou timeout
   └─ SSE: stream contínuo com keepalive

4. Invalidação
   │
   ├─ Mudança de schema (DDL)
   ├─ DELETE explícito via API
   └─ Expiração/cleanup automático
       → Retorna 409 com novo handle → cliente refaz sync
```

### 5.4 Shape Handle Resolution

Quando o cliente envia handle + shape definition:
1. **Fast path**: verificar que o hash da shape definition corresponde ao handle (via ETS)
2. Se falhar, **slow path**: lookup pela shape definition completa
3. Se shape definition mudou ou handle não existe → **409** com novo handle

### 5.5 Change Filtering

Para cada transação do WAL, o sistema avalia se um change pertence a uma shape:

```
convert_change(shape, change):
  - Se tabela != root_table → descarta
  - Se shape sem WHERE e selects_all_columns → aceita (fast path)
  - Para INSERT/DELETE: avalia WHERE clause contra o record
  - Para UPDATE:
    - old_in_shape = WHERE(old_record)
    - new_in_shape = WHERE(new_record)
    - (true, true)   → UPDATE
    - (true, false)   → DELETE (record saiu da shape)
    - (false, true)   → INSERT (record entrou na shape)
    - (false, false)  → descarta
  - Filtra colunas pelo selected_columns
  - Preenche move_tags se shape tem dependências
```

---

## 6. Storage Backend

### 6.1 Interface (Behaviour)

```
Storage callbacks:
  shared_opts(config)                    → compiled_opts
  for_shape(handle, compiled_opts)       → shape_opts

  # Lifecycle
  stack_start_link(compiled_opts)        → GenServer.on_start
  start_link(shape_opts)                 → GenServer.on_start
  init_writer!(shape_opts, shape_def)    → writer_state
  terminate(writer_state)                → any
  hibernate(writer_state)                → writer_state

  # Discovery
  get_all_stored_shape_handles(opts)     → {:ok, MapSet} | {:error, term}
  get_stored_shapes(opts, handles)       → %{handle => {:ok, Shape} | {:error, term}}

  # Reading
  fetch_latest_offset(shape_opts)        → {:ok, LogOffset} | {:error, term}
  get_log_stream(offset, max_offset, opts) → Enumerable
  get_chunk_end_log_offset(offset, opts) → LogOffset | nil
  snapshot_started?(shape_opts)          → boolean

  # Writing
  make_new_snapshot!(stream, opts)       → :ok
  mark_snapshot_as_started(opts)         → :ok
  append_to_log!(log_items, writer)      → writer_state
  append_control_message!(msg, writer)   → {range, writer_state}

  # Maintenance
  cleanup!(shape_opts)                   → any
  compact(shape_opts, keep_chunks)       → :ok

  # PG Snapshot (xmin/xmax tracking)
  fetch_pg_snapshot(opts)                → {:ok, snapshot | nil}
  set_pg_snapshot(snapshot, opts)        → :ok
```

### 6.2 PureFileStorage (implementação actual)

- Baseado em **SQLite** (via `exqlite`)
- Cada shape tem o seu directório no filesystem
- Snapshot e log são armazenados como ficheiros
- Chunk boundaries são tracked para permitir leitura parcial
- Suporta compaction (remover chunks antigos mantendo N recentes)

### 6.3 Formato dos Log Items no Storage

```
log_item = {LogOffset, key, operation_type, json_iodata}
```

Onde `json_iodata` é o JSON pré-serializado para envio directo ao cliente.

---

## 7. Replicação PostgreSQL

### 7.1 Componentes

#### ReplicationClient
- Usa `Postgrex.ReplicationConnection` (protocolo de replicação lógica PG)
- Gere o ciclo: connect → create publication → create slot → start streaming
- Converte mensagens WAL em `Relation` e `TransactionFragment`
- Reporta progresso (flushed LSN) de volta ao PG via standby status updates

#### ShapeLogCollector (componente central)
- Recebe eventos do ReplicationClient (synchronous call com timeout infinito)
- Mantém um **Partitions** index para routing eficiente por tabela
- Usa **EventRouter** para mapear changes → shapes afectadas
- Processa em **DependencyLayers** para garantir ordem entre shapes dependentes
- Publica eventos via **ConsumerRegistry** para os Consumer GenServers
- Tracking de flush para feedback ao PG (via **FlushTracker**)

#### Consumer (por shape)
- GenServer temporário que gere uma shape individual
- Responsável por:
  1. **Snapshot inicial**: query ao PG + escrita no storage
  2. **Change handling**: converte e escreve changes no log
  3. **Move-in handling**: subqueries para shapes com dependências
- Lifecycle: criado quando shape é pedida → termina quando shape é eliminada

### 7.2 Modelo de Publicação

- Uma **publication** PostgreSQL por stack (ex: `electric_publication_default`)
- Tabelas são adicionadas/removidas dinamicamente da publication
- **PublicationManager** gere debouncing de alterações à publication
- Suporta modos: managed (Electric gere publication) ou manual (utilizador gere)

### 7.3 Replication Slot

- Um **logical replication slot** por stack (ex: `electric_slot_default`)
- Pode ser temporário ou permanente
- O LSN de flush é reportado ao PG para permitir cleanup do WAL
- Em caso de crash, a re-leitura desde o último flush LSN é safe (idempotente)

### 7.4 Transação e Fragmentação

Transações grandes são fragmentadas em `TransactionFragment`:
- `changes`: lista de data changes
- `xid`: ID da transação PG
- `lsn`: LSN do commit
- `last_log_offset`: último offset do fragmento
- `affected_relations`: set de relações afectadas

### 7.5 Inspector (Schema Introspection)

- Carrega informação de colunas, PKs, OIDs das tabelas
- Cache em ETS para performance
- Limpa cache quando recebe relação message (possível DDL)

---

## 8. Supervisão e Processo

### 8.1 Árvore de Supervisão

```
Electric.Supervisor (one_for_one)
├── Registry (stack_events)
├── AdmissionControl
├── StackSupervisor
│   ├── ProcessRegistry
│   ├── StatusMonitor
│   ├── PersistentKV
│   ├── Storage (stack-wide)
│   ├── ShapeCache (GenServer)
│   ├── ShapeLogCollector (GenServer)
│   ├── ShapeStatus (ETS owner)
│   ├── LsnTracker (ETS)
│   ├── Connection.Supervisor
│   │   ├── ReplicationClient
│   │   ├── DB Pool (Postgrex)
│   │   └── PublicationManager
│   ├── DynamicConsumerSupervisor
│   │   └── Consumer (per-shape, dynamic)
│   └── ShapeCleaner
│       └── ExpiryManager
└── Bandit (HTTP server)
```

### 8.2 Processos Chave

| Processo              | Tipo       | Responsabilidade                        |
|-----------------------|------------|-----------------------------------------|
| ShapeCache            | GenServer  | Serializa criação de shapes             |
| ShapeLogCollector     | GenServer  | Processa WAL e encaminha para consumers |
| Consumer              | GenServer  | Gere uma shape individual               |
| ReplicationClient     | ReplicationConnection | Ligação ao PG WAL                |
| StatusMonitor         | GenServer  | Estado do stack (up/down/sleeping)      |
| ShapeCleaner          | GenServer  | Cleanup de shapes expiradas             |
| LsnTracker            | ETS-backed | Último LSN processado (global)          |

---

## 9. Admission Control

- Limita pedidos concorrentes com semáforos por tipo:
  - `initial`: pedidos com offset=-1 (mais pesados - causam snapshots)
  - `existing`: pedidos com offset != -1 (mais leves - leitura de log)
- Retorna 503 com `retry-after` quando sobrecarregado
- Jitter no retry-after para evitar thundering herd

---

## 10. Live Mode (Long-Polling e SSE)

### 10.1 Long-Polling

1. Cliente envia `live=true&offset={last_offset}&handle={handle}`
2. Servidor verifica se há novos dados desde o offset
3. Se não há dados:
   - Regista listener no Registry para a shape
   - Bloqueia (Elixir `receive`) até:
     - Nova mudança (`{ref, :new_changes, latest_offset}`)
     - Shape rotação (`{ref, :shape_rotation, new_handle}`)
     - Timeout (`long_poll_timeout`, default 20s) → retorna `up-to-date`
4. Se há dados: retorna chunk normal

### 10.2 SSE (Server-Sent Events)

1. Cliente envia `live=true&live_sse=true`
2. Resposta usa `content-type: text/event-stream`
3. Stream contínuo com:
   - Dados formatados como SSE events (`data: {json}\n\n`)
   - Keepalive comments (`: keep-alive\n\n`) a cada `keepalive_interval` (21s)
   - Timeout global (`sse_timeout`, 60s) após o qual o stream termina
4. Modelo de estado: receive → emit (stream items) → receive → ...

---

## 11. Componentes Essenciais para Reimplementação

### 11.1 Tier 1 - Mínimo Viável

1. **HTTP API Server** - endpoint `/v1/shape` com GET e parâmetros base
2. **PostgreSQL Replication Client** - ligação via protocolo de replicação lógica
3. **WAL Decoder** - descodificação de mensagens de replicação lógica
4. **Shape Definition** - parsing de table, where, columns
5. **Shape Registry** - mapeamento shape_def ↔ handle, lookup rápido
6. **Log Storage** - append de log items, leitura por offset range
7. **Snapshot Engine** - query inicial ao PG e armazenamento
8. **Change Filter** - avaliação de WHERE clauses contra records
9. **Log Offset System** - representação e comparação de offsets
10. **Response Encoder** - serialização JSON dos log items

### 11.2 Tier 2 - Funcionalidade Completa

11. **Live Mode (Long-poll)** - hold de requests até novo dado
12. **SSE Mode** - streaming contínuo
13. **Cache Headers** - estratégia de caching CDN-friendly
14. **ETag/If-None-Match** - validação de cache
15. **Chunking** - divisão do log em chunks com boundaries
16. **Compaction** - limpeza de chunks antigos
17. **Admission Control** - limitação de concorrência
18. **Authentication** - API secret
19. **Shape Deletion** - DELETE endpoint
20. **Publication Management** - gestão dinâmica de tabelas na publication PG

### 11.3 Tier 3 - Funcionalidades Avançadas

21. **Subquery Shapes** - shapes com WHERE que referencia outras tabelas
22. **Move Tags** - tracking de move-in/out entre shapes dependentes
23. **Subset Queries** - snapshots parciais com ORDER/LIMIT/OFFSET
24. **Replica Full Mode** - old_value em updates
25. **Column Filtering** - selecção de colunas específicas
26. **Schema Change Detection** - invalidação de shapes em DDL
27. **Idle Connection Sleep** - pausa de replicação em inactividade
28. **Flush Tracking** - feedback de progresso ao PG

---

## 12. Interfaces e Protocolos Chave

### 12.1 Storage Interface

Qualquer reimplementação precisa de implementar:

```
trait Storage {
  // Configuração
  fn for_shape(handle, config) -> ShapeStorage

  // Escrita
  fn make_new_snapshot(stream, shape_storage) -> Result<()>
  fn append_to_log(items: Vec<LogItem>, writer: &mut Writer)
  fn mark_snapshot_started(shape_storage) -> Result<()>

  // Leitura
  fn get_log_stream(since: Offset, up_to: Offset, storage) -> Stream<JsonData>
  fn get_chunk_end_offset(offset, storage) -> Option<Offset>
  fn fetch_latest_offset(storage) -> Result<Offset>
  fn snapshot_started(storage) -> bool

  // Manutenção
  fn cleanup(storage)
  fn compact(storage, keep_chunks: usize)
}
```

### 12.2 Inspector Interface

```
trait Inspector {
  fn load_relation_oid(relation: (String, String)) -> Result<(Oid, Relation)>
  fn load_column_info(oid: Oid) -> Result<Vec<ColumnInfo>>
  fn get_pk_cols(columns: &[ColumnInfo]) -> Vec<String>
  fn load_supported_features() -> Result<Features>
  fn clean(oid: Oid)  // Invalida cache para esta relação
}
```

### 12.3 Shape Matching / Event Router

```
trait EventRouter {
  fn add_shape(handle, shape)
  fn remove_shape(handle)
  fn has_shape(handle) -> bool
  fn active_shapes() -> Set<Handle>
  fn event_by_shape_handle(txn_fragment) -> Map<Handle, FilteredEvent>
}
```

---

## 13. Formato de Serialização para Persistência

### 13.1 Shape Definition (JSON)

```json
{
  "version": 1,
  "root_table": ["public", "users"],
  "root_table_id": 16385,
  "root_pks": ["id"],
  "root_column_count": 4,
  "flags": {"selects_all_columns": true},
  "where": null,
  "selected_columns": ["id", "email", "name"],
  "explicitly_selected_columns": ["id", "email", "name"],
  "storage": {"compaction": "disabled"},
  "replica": "default",
  "shape_dependencies": [],
  "log_mode": "full"
}
```

### 13.2 PG Snapshot (para consistência transaccional)

```json
{
  "xmin": 12345,
  "xmax": 12350,
  "xip_list": [12347, 12348],
  "filter_txns?": true
}
```

---

## 14. Decisões de Design Importantes

### 14.1 Snapshot Consistency

O snapshot e o log devem ser consistentes. O mecanismo:
1. Antes de fazer o snapshot query, gravar o `pg_snapshot` (xmin/xmax/xip_list)
2. O snapshot query é feito com `SET TRANSACTION SNAPSHOT`
3. Transações com `xid >= xmin` vindas do WAL são filtradas contra o snapshot:
   - Se `xid` está in `xip_list` (in progress durante snapshot) → manter no log
   - Se `xid < xmax` e não em `xip_list` → já incluído no snapshot, descartar
   - Se `xid >= xmax` → posterior ao snapshot, manter no log

### 14.2 409 Conflict como mecanismo de redirecção

Quando uma shape é invalidada:
- O servidor retorna 409 com o novo `handle` no header
- O cliente descarta dados locais e reinicia o sync com o novo handle
- Isto funciona como um "redirect" que força cache invalidation

### 14.3 Offset como cursor de paginação + cache key

O offset serve dois propósitos:
1. **Cursor**: indica ao servidor onde o cliente ficou
2. **Cache key**: `{handle}:{request_offset}:{response_offset}` forma o ETag

### 14.4 CDN Compatibility

Toda a API é desenhada para cache:
- Respostas são determinísticas para o mesmo offset range
- Long-poll timeout é ligeiramente menor que max-age para evitar stale
- SSE timeout permite request collapsing em CDNs

### 14.5 Processamento Single-Threaded por Shape

Cada shape tem um Consumer GenServer que processa sequencialmente:
- Evita race conditions no storage
- Simplifica a lógica de move-in/move-out
- Escalabilidade vem do número de shapes (um processo por shape)

### 14.6 Dependency Layers

Shapes com subqueries (dependências) são processadas em layers:
- Layer 0: shapes sem dependências
- Layer N: shapes que dependem de shapes em layers anteriores
- Cada layer é processada sequencialmente, garantindo que as dependências já foram processadas

---

## 15. Configuração Principal

| Variável                   | Default   | Descrição                                       |
|----------------------------|-----------|--------------------------------------------------|
| `SERVICE_PORT`             | 3000      | Porta do servidor HTTP                            |
| `DATABASE_URL`             | -         | URL de conexão ao PostgreSQL                      |
| `ELECTRIC_SECRET`          | nil       | API secret (nil = sem autenticação)               |
| `LONG_POLL_TIMEOUT`        | 20000ms   | Timeout do long-poll                              |
| `CACHE_MAX_AGE`            | 60s       | max-age para respostas non-live                   |
| `CACHE_STALE_AGE`          | 300s      | stale-while-revalidate                            |
| `CHUNK_BYTES_THRESHOLD`    | ~50KB     | Tamanho do chunk antes de criar boundary          |
| `DB_POOL_SIZE`             | 20        | Tamanho do pool de conexões PG                    |
| `MAX_SHAPES`               | -         | Limite de shapes simultâneas                      |
| `STACK_READY_TIMEOUT`      | 5000ms    | Timeout para o stack ficar pronto                 |
| `REPLICATION_STREAM_ID`    | default   | Identificador do stream de replicação             |
| `REPLICATION_IDLE_TIMEOUT` | 0         | Timeout para idle (0 = desactivado)               |

---

## 16. Glossário

| Termo               | Definição                                                    |
|----------------------|--------------------------------------------------------------|
| **Shape**            | Subconjunto de uma tabela PG definido por table + where + columns |
| **Shape Handle**     | ID único de uma instância de shape (`{hash}-{timestamp}`)    |
| **LogOffset**        | Posição no log: `{tx_offset}_{op_offset}`                    |
| **Snapshot**         | Cópia inicial completa dos dados da shape                     |
| **Log**              | Sequência de operações (insert/update/delete) desde o snapshot|
| **Chunk**            | Segmento do log com um boundary offset                        |
| **Live Mode**        | Modo de sincronização em tempo real (long-poll ou SSE)        |
| **Consumer**         | Processo que gere uma shape individual                        |
| **Publication**      | Objecto PG que controla quais tabelas são replicadas          |
| **Replication Slot** | Slot PG que garante que o WAL não é limpo antes de ser processado |
| **Stack**            | Instância completa do Electric ligada a uma base de dados      |
| **Move-in/Move-out** | Quando um record entra/sai de uma shape por update            |
| **Compaction**       | Remoção de chunks antigos do log para poupar espaço           |
