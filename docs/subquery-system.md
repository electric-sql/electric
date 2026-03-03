# Sistema de Subqueries — Electric SQL

## Índice

1. [Visão Geral (Nível Abstracto)](#1-visão-geral-nível-abstracto)
2. [Pseudo-Código](#2-pseudo-código)
3. [Diagramas de Sequência](#3-diagramas-de-sequência)
4. [Nível Detalhado — Código](#4-nível-detalhado--código)
5. [Sistema de Tags](#5-sistema-de-tags)
6. [Servidor vs Cliente](#6-servidor-vs-cliente)

---

## 1. Visão Geral (Nível Abstracto)

O sistema de subqueries permite que shapes no Electric SQL tenham filtros `WHERE`
que referenciam dados de **outras tabelas** através de subqueries SQL tipo `IN (SELECT ...)`.

### Problema que resolve

Uma shape como:

```sql
SELECT * FROM child WHERE parent_id IN (SELECT id FROM parent WHERE active = true)
```

Precisa que o sistema saiba reagir quando:

- **Move-in**: um parent passa a ser `active = true` → os seus children devem aparecer na shape
- **Move-out**: um parent deixa de ser `active = true` → os seus children devem desaparecer da shape

### Conceitos Fundamentais

| Conceito | Descrição |
|---|---|
| **Shape dependente** | A shape que contém o `IN (SELECT ...)` — a shape exterior (ex: `child`) |
| **Shape de dependência** | A shape implícita criada pela subquery (ex: `parent WHERE active = true`) |
| **Materializer** | Processo que materializa os valores da shape de dependência e detecta move-in/move-out |
| **Consumer** | Processo que gere a shape dependente, reagindo a move-ins e move-outs |
| **Tags** | Hashes MD5 que identificam **porquê** uma row pertence a uma shape (ligação ao valor de dependência) |
| **Move-in** | Quando novos valores aparecem na subquery, triggando uma query para buscar rows afectadas |
| **Move-out** | Quando valores desaparecem da subquery, emitindo uma mensagem para o cliente remover rows |
| **Synthetic Delete** | DELETE gerado pelo cliente quando recebe um move-out e a row já não tem tags restantes |

### Fluxo Resumido

```
PostgreSQL WAL
      │
      ▼
┌─────────────────┐         ┌─────────────────────┐
│  Shape de        │ ──────▶ │  Materializer        │
│  Dependência     │         │  (materializa valores │
│  (parent WHERE   │         │   e detecta mudanças) │
│   active=true)   │         └────────┬──────────────┘
└─────────────────┘                   │
                           ┌──────────┴──────────┐
                           │  move_in / move_out  │
                           ▼                      ▼
                    ┌──────────────┐        ┌──────────────┐
                    │  Consumer da │        │  Consumer da  │
                    │  Shape child │        │  Shape child  │
                    │  (query DB)  │        │  (ctrl msg)   │
                    └──────┬───────┘        └──────┬────────┘
                           │                       │
                           ▼                       ▼
                    ┌──────────────┐        ┌──────────────┐
                    │ Shape Log    │        │ Shape Log     │
                    │ (inserts com │        │ (move-out     │
                    │  tags)       │        │  event)       │
                    └──────┬───────┘        └──────┬────────┘
                           │                       │
                           ▼                       ▼
                    ┌──────────────────────────────────┐
                    │         Cliente (Elixir/TS)       │
                    │  - Tag Tracker                    │
                    │  - Synthetic Deletes              │
                    └──────────────────────────────────┘
```

---

## 2. Pseudo-Código

### 2.1. Inicialização da Shape com Subquery

```
FUNCTION create_shape_with_subquery(shape_definition):
    shape = parse_where_clause(shape_definition)

    // Extrair dependências da WHERE clause
    FOR EACH subquery IN shape.where:
        dep_shape = create_dependency_shape(subquery)
        shape.dependencies.add(dep_shape)
        dep_handle = register_shape(dep_shape)
        shape.dependency_handles.add(dep_handle)

    // Calcular tag_structure — quais colunas determinam os tags
    shape.tag_structure = extract_tag_structure(shape.where)
    // ex: [["parent_id"]] para single-column
    // ex: [[{:hash_together, ["col_a", "col_b"]}]] para composite

    // Calcular expressões de comparação para detectar mudanças de sublink
    shape.comparison_expressions = extract_comparison_expressions(shape.where)

    // Criar materializer para cada dependência
    FOR EACH dep IN shape.dependencies:
        start_materializer(dep)

    RETURN shape
```

### 2.2. Fluxo de Move-In (Server-side)

```
// Materializer detecta novo valor na subquery
FUNCTION on_materializer_value_change(value, action):
    IF action == INCREMENT from 0 to 1:
        notify_subscribers({move_in: [(value, original_string)]})
    ELSE IF action == DECREMENT from 1 to 0:
        notify_subscribers({move_out: [(value, original_string)]})

// Consumer reage ao move-in
FUNCTION process_move_in(state, dep_handle, new_values):
    // 1. Transformar WHERE clause para usar valores concretos
    where_clause = replace_subquery_with_values(
        shape.where, dep_handle, new_values
    )
    // Ex: "parent_id IN (SELECT ...)" → "parent_id = ANY($1::text[]::int8[])"

    // 2. Gerar nome único para este move-in
    name = generate_uuid()

    // 3. Registar como "waiting" (snapshot ainda não é conhecido)
    state.move_ins.add_waiting(name, {sublink_path, values_set})

    // 4. Lançar query assíncrona
    ASYNC:
        snapshot = begin_snapshot_query()
        SEND consumer <- {pg_snapshot_known, name, snapshot}

        results = query_db(shape.table, where_clause)
        write_to_temp_storage(name, results)
        keys = collect_keys(results)

        SEND consumer <- {query_complete, name, keys, snapshot}

    RETURN state

// Consumer recebe notificação de snapshot conhecido
FUNCTION on_pg_snapshot_known(state, name, snapshot):
    state.move_ins.set_snapshot(name, snapshot)
    state.gc_touch_tracker()  // limpar touches obsoletos
    RETURN state

// Consumer recebe resultados da query
FUNCTION on_query_complete(state, name, key_set, snapshot):
    // 1. Copiar resultados do temp storage para o shape log
    //    filtrando rows que já foram vistas no stream (touch_tracker)
    //    e tags que foram moved_out entretanto
    append_move_in_snapshot_to_log(
        name, state.writer, state.touch_tracker,
        snapshot, state.moved_out_tags[name]
    )

    // 2. Mover de "waiting" para "filtering"
    visibility_snapshot = state.move_ins.change_to_filtering(name, key_set)

    // 3. Se temos boundary, emitir snapshot-end control message
    IF visibility_snapshot != nil:
        append_snapshot_end_control(visibility_snapshot)

    // 4. Notificar clientes de novas mudanças
    notify_clients()

    RETURN state
```

### 2.3. Fluxo de Move-Out (Server-side)

```
FUNCTION process_move_out(state, dep_handle, removed_values):
    // 1. Gerar padrões de move-out com tag hashes
    patterns = []
    FOR EACH value IN removed_values:
        hash = md5(stack_id + shape_handle + namespace(value))
        patterns.add({pos: 0, value: hash})

    // 2. Criar mensagem de controlo
    message = {
        headers: {
            event: "move-out",
            patterns: patterns
        }
    }

    // 3. Registar tags que foram moved-out (para filtrar move-ins concorrentes)
    state.move_ins.record_move_out(pattern_values)

    // 4. Escrever no shape log
    append_control_message(message, state.writer)

    RETURN state
```

### 2.4. Filtragem de Changes com Dependências (Server-side)

```
FUNCTION process_change_with_dependencies(change, state, xid):
    // 1. Verificar se a change já está visível num move-in resolvido
    IF change_already_in_resolved_move_in(change, state, xid):
        SKIP  // evitar duplicados

    // 2. Verificar se a change será coberta por um move-in pendente
    IF change_will_be_covered_by_pending_move_in(change, state, xid):
        // Exceção: se o UpdatedRecord mudou o valor do sublink,
        // NÃO skip (precisa de tag transition)
        IF change is UpdatedRecord AND sublink_value_changed(change):
            CONTINUE  // processar normalmente
        ELSE:
            SKIP  // o move-in vai trazer esta row

    // 3. Processar normalmente
    converted = convert_change(shape, change)  // aplica WHERE, gera tags
    IF converted is not empty:
        track_touch(xid, converted)
        emit(converted)
```

### 2.5. Cliente — Processamento de Mensagens

```
FUNCTION process_stream_message(message, state):
    MATCH message:
        CASE ChangeMessage:
            // Atualizar tag index
            new_tags = message.headers.tags
            removed_tags = message.headers.removed_tags
            state.tag_tracker.update(message.key, new_tags, removed_tags, message)
            EMIT message

        CASE MoveOutMessage:
            // Para cada padrão, encontrar keys com esse tag
            FOR EACH pattern IN message.patterns:
                keys = state.tag_to_keys[pattern.value]
                FOR EACH key IN keys:
                    // Remover o tag da key
                    remaining_tags = state.key_data[key].tags - {pattern.value}
                    IF remaining_tags is empty:
                        // Gerar synthetic DELETE
                        synthetic = create_delete(key, state.key_data[key].msg)
                        EMIT synthetic
                        DELETE state.key_data[key]
                    ELSE:
                        state.key_data[key].tags = remaining_tags

        CASE ControlMessage(up_to_date):
            state.up_to_date = true
            EMIT message

        CASE ControlMessage(snapshot_end):
            SKIP  // interno, não emitir para o consumidor
```

---

## 3. Diagramas de Sequência

### 3.1. Move-In — Exemplo Concreto

**Cenário**: Um parent (`id='p1'`) é atualizado para `active = true`.
A shape é `SELECT * FROM child WHERE parent_id IN (SELECT id FROM parent WHERE active = true)`.
Existem dois children: `child-1` e `child-2` com `parent_id = 'p1'`.

```
┌──────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐  ┌──────────┐  ┌────────┐
│PostgreSQL│  │  Consumer    │  │ Materializer │  │  Consumer   │  │Shape Log │  │ Client │
│   WAL    │  │  (parent     │  │  (parent     │  │  (child     │  │  (child) │  │(Elixir)│
│          │  │   shape)     │  │   shape)     │  │   shape)    │  │          │  │        │
└────┬─────┘  └──────┬───────┘  └──────┬───────┘  └──────┬──────┘  └────┬─────┘  └───┬────┘
     │               │                 │                  │              │             │
     │ UPDATE parent │                 │                  │              │             │
     │ SET active=   │                 │                  │              │             │
     │   true        │                 │                  │              │             │
     │ WHERE id='p1' │                 │                  │              │             │
     │──────────────▶│                 │                  │              │             │
     │               │                 │                  │              │             │
     │               │ INSERT into     │                  │              │             │
     │               │ parent shape    │                  │              │             │
     │               │ log (p1 now     │                  │              │             │
     │               │ matches active  │                  │              │             │
     │               │ =true)          │                  │              │             │
     │               │                 │                  │              │             │
     │               │ new_changes     │                  │              │             │
     │               │ ───────────────▶│                  │              │             │
     │               │                 │                  │              │             │
     │               │                 │ value_count(p1): │              │             │
     │               │                 │ 0 → 1           │              │             │
     │               │                 │ (move_in!)       │              │             │
     │               │                 │                  │              │             │
     │               │                 │ {:materializer_  │              │             │
     │               │                 │  changes,        │              │             │
     │               │                 │  dep_handle,     │              │             │
     │               │                 │  move_in: [p1]}  │              │             │
     │               │                 │ ────────────────▶│              │             │
     │               │                 │                  │              │             │
     │               │                 │                  │ Transform    │             │
     │               │                 │                  │ WHERE clause:│             │
     │               │                 │                  │ "parent_id = │             │
     │               │                 │                  │  ANY($1::    │             │
     │               │                 │                  │  text[]::    │             │
     │               │                 │                  │  uuid[])"    │             │
     │               │                 │                  │              │             │
     │               │                 │                  │ add_waiting  │             │
     │               │                 │                  │ (name, p1)   │             │
     │               │                 │                  │              │             │
     │               │                 │                  │ ASYNC query  │             │
     │               │                 │                  │ to PostgreSQL│             │
     │               │                 │                  │──────────────│─ ─ ─ ─ ─ ┐ │
     │               │                 │                  │              │           │ │
     │◀ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│─ BEGIN       │           │ │
     │               │                 │                  │  snapshot    │           │ │
     │─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ▶│  query       │           │ │
     │               │                 │                  │              │           │ │
     │               │                 │                  │{pg_snapshot_ │           │ │
     │               │                 │                  │ known,name,  │           │ │
     │               │                 │                  │ snapshot}    │           │ │
     │               │                 │                  │◀─ ─ ─ self() │           │ │
     │               │                 │                  │              │           │ │
     │               │                 │                  │ set_snapshot │           │ │
     │               │                 │                  │ gc_touches   │           │ │
     │               │                 │                  │              │           │ │
     │◀ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│ SELECT key,  │           │ │
     │               │                 │                  │ tags, json   │           │ │
     │               │                 │                  │ FROM child   │           │ │
     │               │                 │                  │ WHERE        │           │ │
     │               │                 │                  │ parent_id =  │           │ │
     │               │                 │                  │ ANY(['p1'])  │           │ │
     │─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ▶│              │           │ │
     │               │                 │                  │ rows:        │           │ │
     │               │                 │                  │ child-1,     │           │ │
     │               │                 │                  │ child-2      │           │ │
     │               │                 │                  │              │           │ │
     │               │                 │                  │ write_move_  │           │ │
     │               │                 │                  │ in_snapshot  │           │ │
     │               │                 │                  │─────────────▶│         ◀─┘ │
     │               │                 │                  │              │             │
     │               │                 │                  │{query_move_  │             │
     │               │                 │                  │ in_complete, │             │
     │               │                 │                  │ name,keys,   │             │
     │               │                 │                  │ snapshot}    │             │
     │               │                 │                  │◀─ ─ ─ self() │             │
     │               │                 │                  │              │             │
     │               │                 │                  │ append_move_ │             │
     │               │                 │                  │ in_snapshot_ │             │
     │               │                 │                  │ to_log       │             │
     │               │                 │                  │─────────────▶│             │
     │               │                 │                  │              │             │
     │               │                 │                  │ change_to_   │             │
     │               │                 │                  │ filtering    │             │
     │               │                 │                  │              │             │
     │               │                 │                  │ append       │             │
     │               │                 │                  │ snapshot-end │             │
     │               │                 │                  │ control msg  │             │
     │               │                 │                  │─────────────▶│             │
     │               │                 │                  │              │             │
     │               │                 │                  │notify clients│             │
     │               │                 │                  │──────────────│────────────▶│
     │               │                 │                  │              │             │
     │               │                 │                  │              │  Client     │
     │               │                 │                  │              │  recebe:    │
     │               │                 │                  │              │  INSERT     │
     │               │                 │                  │              │  child-1    │
     │               │                 │                  │              │  tags:      │
     │               │                 │                  │              │  [md5hash]  │
     │               │                 │                  │              │             │
     │               │                 │                  │              │  INSERT     │
     │               │                 │                  │              │  child-2    │
     │               │                 │                  │              │  tags:      │
     │               │                 │                  │              │  [md5hash]  │
     │               │                 │                  │              │             │
     │               │                 │                  │              │  TagTracker │
     │               │                 │                  │              │  .update()  │
     │               │                 │                  │              │  para cada  │
     │               │                 │                  │              │  row        │
     │               │                 │                  │              │             │
```

### 3.2. Move-Out — Exemplo Concreto

**Cenário**: O parent (`id='p1'`) é atualizado para `active = false`.
Os children `child-1` e `child-2` já estão na shape com tag `md5hash(stack+handle+"v:p1")`.

```
┌──────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐  ┌──────────┐  ┌────────┐
│PostgreSQL│  │  Consumer    │  │ Materializer │  │  Consumer   │  │Shape Log │  │ Client │
│   WAL    │  │  (parent     │  │  (parent     │  │  (child     │  │  (child) │  │(Elixir)│
│          │  │   shape)     │  │   shape)     │  │   shape)    │  │          │  │        │
└────┬─────┘  └──────┬───────┘  └──────┬───────┘  └──────┬──────┘  └────┬─────┘  └───┬────┘
     │               │                 │                  │              │             │
     │ UPDATE parent │                 │                  │              │             │
     │ SET active=   │                 │                  │              │             │
     │   false       │                 │                  │              │             │
     │ WHERE id='p1' │                 │                  │              │             │
     │──────────────▶│                 │                  │              │             │
     │               │                 │                  │              │             │
     │               │ record          │                  │              │             │
     │               │ converted to    │                  │              │             │
     │               │ DELETE (p1 no   │                  │              │             │
     │               │ longer matches  │                  │              │             │
     │               │ active=true)    │                  │              │             │
     │               │                 │                  │              │             │
     │               │ new_changes     │                  │              │             │
     │               │ ───────────────▶│                  │              │             │
     │               │                 │                  │              │             │
     │               │                 │ value_count(p1): │              │             │
     │               │                 │ 1 → 0           │              │             │
     │               │                 │ (move_out!)      │              │             │
     │               │                 │                  │              │             │
     │               │                 │ {:materializer_  │              │             │
     │               │                 │  changes,        │              │             │
     │               │                 │  dep_handle,     │              │             │
     │               │                 │  move_out: [p1]} │              │             │
     │               │                 │ ────────────────▶│              │             │
     │               │                 │                  │              │             │
     │               │                 │                  │ Generate     │             │
     │               │                 │                  │ move-out     │             │
     │               │                 │                  │ patterns:    │             │
     │               │                 │                  │ [{pos: 0,    │             │
     │               │                 │                  │   value:     │             │
     │               │                 │                  │   md5(stack  │             │
     │               │                 │                  │   +handle    │             │
     │               │                 │                  │   +"v:p1")}] │             │
     │               │                 │                  │              │             │
     │               │                 │                  │ Append       │             │
     │               │                 │                  │ control msg: │             │
     │               │                 │                  │ {event:      │             │
     │               │                 │                  │  "move-out", │             │
     │               │                 │                  │  patterns:   │             │
     │               │                 │                  │  [...]}      │             │
     │               │                 │                  │─────────────▶│             │
     │               │                 │                  │              │             │
     │               │                 │                  │notify clients│             │
     │               │                 │                  │──────────────│────────────▶│
     │               │                 │                  │              │             │
     │               │                 │                  │              │  Client     │
     │               │                 │                  │              │  recebe     │
     │               │                 │                  │              │  MoveOut    │
     │               │                 │                  │              │  Message    │
     │               │                 │                  │              │             │
     │               │                 │                  │              │  TagTracker │
     │               │                 │                  │              │  .generate_ │
     │               │                 │                  │              │  synthetic_ │
     │               │                 │                  │              │  deletes()  │
     │               │                 │                  │              │             │
     │               │                 │                  │              │  Encontra:  │
     │               │                 │                  │              │  tag_to_keys│
     │               │                 │                  │              │  [md5hash]  │
     │               │                 │                  │              │  = {child-1,│
     │               │                 │                  │              │    child-2} │
     │               │                 │                  │              │             │
     │               │                 │                  │              │  child-1:   │
     │               │                 │                  │              │   remaining │
     │               │                 │                  │              │   tags = {} │
     │               │                 │                  │              │   → SYNTH.  │
     │               │                 │                  │              │     DELETE  │
     │               │                 │                  │              │             │
     │               │                 │                  │              │  child-2:   │
     │               │                 │                  │              │   remaining │
     │               │                 │                  │              │   tags = {} │
     │               │                 │                  │              │   → SYNTH.  │
     │               │                 │                  │              │     DELETE  │
     │               │                 │                  │              │             │
     │               │                 │                  │              │  O consumer │
     │               │                 │                  │              │  da app     │
     │               │                 │                  │              │  recebe 2   │
     │               │                 │                  │              │  DELETEs    │
     │               │                 │                  │              │             │
```

### 3.3. Caso Especial — Row com Múltiplos Tags (Move-Out Parcial)

Se `child-1` pertence à shape por **dois** parents activos (`p1` e `p2`), e `p1` é desactivado:

```
Estado antes do move-out:
  tag_to_keys:
    md5("...v:p1") → {child-1}
    md5("...v:p2") → {child-1}
  key_data:
    child-1 → {tags: {md5p1, md5p2}, msg: <last insert>}

Move-out pattern: [{pos: 0, value: md5("...v:p1")}]

Resultado:
  - Remove md5p1 do tag_to_keys
  - child-1 remaining_tags = {md5p2} → NÃO EMPTY → NÃO gera delete
  - child-1 continua na shape (ainda pertence via parent p2)
```

---

## 4. Nível Detalhado — Código

### 4.1. Estrutura da Shape (`shape.ex`)

A struct `Shape` contém os campos relevantes para subqueries:

```elixir
defstruct [
  # ...
  shape_dependencies: [],              # Lista de shapes de dependência (subquery shapes)
  shape_dependencies_handles: [],      # Handles das shapes de dependência registadas
  tag_structure: [],                   # Estrutura para gerar tags por row
  subquery_comparison_expressions: %{} # Expressões para detectar mudanças de sublink value
]
```

**`shape_dependencies`**: Cada dependência é ela própria uma `Shape` — representa a subquery
(ex: `SELECT id FROM parent WHERE active = true`).

**`shape_dependencies_handles`**: Os handles (IDs) dessas shapes no sistema. Usados para correlacionar
events do materializer com o índice correcto da dependência.

**`tag_structure`**: Derivada da WHERE clause. Para `parent_id IN (SELECT id FROM parent ...)`,
será `[["parent_id"]]` — indicando que para cada row, o tag é calculado a partir do valor de `parent_id`.

**`subquery_comparison_expressions`**: Mapa de `{path → expression}`. Usado para detectar quando
um `UpdatedRecord` muda o valor da coluna de ligação (ex: `child.parent_id` muda de `p1` para `p2`).

### 4.2. SubqueryMoves (`shape/subquery_moves.ex`)

Este módulo é o coração da transformação de queries e geração de tags.

#### `move_in_where_clause/3`

Transforma a WHERE clause original, substituindo a subquery por valores concretos:

- **Single column**: `parent_id IN (SELECT id FROM ...)` → `parent_id = ANY($1::text[]::uuid[])`
- **Composite key**: `(a, b) IN (SELECT x, y FROM ...)` → `(a, b) IN (SELECT * FROM unnest($1::text[]::int[], $2::text[]::text[]))`

```elixir
# Para single column:
{String.replace(query, target_section, "= ANY ($1::text[]::#{type})"), [move_ins]}

# Para composite key:
{String.replace(query, target_section, "IN (SELECT * FROM unnest(#{unnest_sections}))"),
 Electric.Utils.unzip_any(move_ins) |> Tuple.to_list()}
```

#### `make_value_hash/3` e `make_value_hash_raw/3`

Geram o hash MD5 que identifica um tag:

```elixir
def make_value_hash(stack_id, shape_handle, value) do
  make_value_hash_raw(stack_id, shape_handle, namespace_value(value))
end

def make_value_hash_raw(stack_id, shape_handle, namespaced_value) do
  :crypto.hash(:md5, "#{stack_id}#{shape_handle}#{namespaced_value}")
  |> Base.encode16(case: :lower)
end
```

#### `namespace_value/1`

Distingue valores `NULL` de strings literais:

```elixir
def namespace_value(nil), do: "NULL"        # sem prefixo
def namespace_value(value), do: "v:" <> value  # com prefixo "v:"
```

Isto é **crítico** — o SQL side (`querying.ex`) usa a mesma lógica via `pg_namespace_value_sql/1`:

```sql
CASE WHEN col::text IS NULL THEN 'NULL' ELSE 'v:' || col::text END
```

#### `move_in_tag_structure/1`

Percorre a AST da WHERE clause para extrair a estrutura de tags:

```elixir
# Para WHERE parent_id IN (SELECT id FROM parent WHERE active = true):
# Resultado: {[["parent_id"]], %{["$sublink", "0"] => <expr>}}

# Para WHERE (col_a, col_b) IN (SELECT ...):
# Resultado: {[[{:hash_together, ["col_a", "col_b"]}]], %{...}}
```

#### `make_move_out_control_message/4`

Gera a mensagem de move-out com padrões de tag:

```elixir
%{
  headers: %{
    event: "move-out",
    patterns: [%{pos: 0, value: "a1b2c3d4..."}]  # MD5 hex
  }
}
```

### 4.3. Consumer MoveIns (`consumer/move_ins.ex`)

Máquina de estados para move-ins:

```
┌─────────────────┐
│  Trigger:       │
│  materializer   │
│  sends move_in  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   WAITING       │  snapshot = nil
│                 │  values = MapSet{p1}
│   add_waiting() │
└────────┬────────┘
         │ {:pg_snapshot_known}
         ▼
┌─────────────────┐
│   WAITING       │  snapshot = {xmin, xmax, xip_list}
│   (with         │
│   snapshot)     │
│   set_snapshot()│
└────────┬────────┘
         │ {:query_move_in_complete}
         ▼
┌─────────────────┐
│   FILTERING     │  snapshot + key_set
│                 │  (skip changes already in move-in)
│ change_to_      │
│ filtering()     │
└────────┬────────┘
         │ Quando xid > xmax do snapshot
         ▼
┌─────────────────┐
│   COMPLETED     │
│                 │
│ remove_         │
│ completed()     │
└─────────────────┘
```

**Campos do state**:

| Campo | Tipo | Propósito |
|-------|------|-----------|
| `waiting_move_ins` | `%{name => {snapshot, {path, values}}}` | Move-ins pendentes |
| `filtering_move_ins` | `[{snapshot, key_set}]` | Move-ins resolvidos, a filtrar duplicados |
| `touch_tracker` | `%{key => xid}` | Último xid que tocou cada key |
| `move_in_buffering_snapshot` | `{xmin, xmax, xip_list}` | União de todos os snapshots pendentes |
| `in_flight_values` | `%{path => MapSet}` | Valores em voo (para skip de changes) |
| `moved_out_tags` | `%{name => MapSet}` | Tags moved-out durante move-in |

#### `move_in_buffering_snapshot`

É a **união** de todos os snapshots de move-ins pendentes:
- `xmin = min(todos os xmin)`
- `xmax = max(todos os xmax)`
- `xip_list = concat(todos os xip_list)`

Permite verificar num único teste se uma transação é visível em **algum** dos move-ins pendentes.

#### `touch_tracker`

Rastreia o último `xid` que modificou cada key no stream. Quando os resultados da query de move-in
chegam, rows que foram "tocadas" por transações **não visíveis** no snapshot da query são saltadas
(temos dados mais recentes no stream).

### 4.4. MoveHandling (`consumer/move_handling.ex`)

Orquestra move-ins e move-outs. É chamado pelo Consumer.

#### `process_move_ins/3`

1. Gera a WHERE clause transformada via `SubqueryMoves.move_in_where_clause/3`
2. Lança query assíncrona via `PartialModes.query_move_in_async/6`
3. Regista o move-in como "waiting" em `MoveIns.add_waiting/3`
4. A query corre num `Task.Supervisor` child, envia mensagens ao consumer:
   - `{:pg_snapshot_known, name, snapshot}` — quando o snapshot PG é obtido
   - `{:query_move_in_complete, name, key_set, snapshot}` — quando a query termina

#### `process_move_outs/3`

1. Gera a mensagem de move-out via `SubqueryMoves.make_move_out_control_message/4`
2. Regista os tags moved-out via `MoveIns.move_out_happened/2`
3. Escreve a mensagem de controlo no shape log

#### `query_complete/4`

1. Copia resultados do temp storage para o log principal, filtrando:
   - Rows no `touch_tracker` com xid mais recente que o snapshot
   - Tags que foram moved-out durante o move-in
2. Transiciona de "waiting" para "filtering"
3. Se é a última move-in pendente ou tem o snapshot mínimo, emite `snapshot-end`

### 4.5. ChangeHandling (`consumer/change_handling.ex`)

Filtragem de changes no stream com consciência de move-ins.

#### Sem dependências (fast path)

```elixir
# Simplesmente converte a change e emite
Shape.convert_change(shape, change, opts)
```

#### Com dependências

Antes de converter, verifica:

1. **`change_visible_in_resolved_move_ins?`**: A change já está nos resultados de um move-in
   resolvido? Se sim, skip (evitar duplicados).

2. **`change_will_be_covered_by_move_in?`**: A change será incluída num move-in pendente?
   - Verifica se o valor do sublink está nos `in_flight_values`
   - Verifica se a transação é visível no snapshot do move-in
   - **Exceção**: Se é um `UpdatedRecord` com mudança no valor do sublink, NÃO skip
     (precisa de propagar a mudança de tags)
   - Verifica que a row ainda corresponde à WHERE clause completa

### 4.6. Materializer (`consumer/materializer.ex`)

O Materializer é um GenServer que materializa os valores de uma shape de dependência.

#### Estrutura

```elixir
%{
  index: %{key => casted_value},       # Mapa de key para valor materializado
  tag_indices: %{tag => MapSet<key>},   # Índice invertido tag → keys
  value_counts: %{value => count},      # Contagem de referências por valor
  pending_events: %{},                  # Eventos pendentes (move_in/move_out)
  subscribers: MapSet.new()             # PIDs dos consumers subscritores
}
```

#### Detecção de Move-In/Move-Out

Baseada na contagem de referências (`value_counts`):

```elixir
# Inserção de novo valor
defp increment_value({value_counts, events}, value, original_string) do
  case Map.fetch(value_counts, value) do
    {:ok, count} ->
      # Já existia, incrementar contagem
      {Map.put(value_counts, value, count + 1), events}
    :error ->
      # Novo valor! 0 → 1 = MOVE_IN
      {Map.put(value_counts, value, 1), [{:move_in, {value, original_string}} | events]}
  end
end

# Remoção de valor
defp decrement_value({value_counts, events}, value, original_string) do
  case Map.fetch!(value_counts, value) do
    1 ->
      # Contagem vai a 0 = MOVE_OUT
      {Map.delete(value_counts, value), [{:move_out, {value, original_string}} | events]}
    count ->
      # Ainda há referências
      {Map.put(value_counts, value, count - 1), events}
  end
end
```

#### Cancelamento de Eventos (dentro da mesma transaction)

Se o mesmo valor fizer move_in e move_out na mesma batch, os eventos cancelam-se:

```elixir
defp cancel_matching_move_events(events) do
  ins = events |> Map.get(:move_in, []) |> Enum.sort_by(fn {v, _} -> v end)
  outs = events |> Map.get(:move_out, []) |> Enum.sort_by(fn {v, _} -> v end)
  cancel_sorted_pairs(ins, outs, %{move_in: [], move_out: []})
end
```

#### Processamento de Move-Out Events do Log

O Materializer também processa eventos `move-out` que vêm do log da shape de dependência
(quando essa dependência é ela própria dependente de outra shape):

```elixir
%{headers: %{event: "move-out", patterns: patterns}} ->
  {keys, tag_indices} = pop_keys_from_tag_indices(tag_indices, patterns)
  # Para cada key removida, decrementa o valor
```

### 4.7. Querying (`querying.ex`)

#### `query_move_in/5`

Executa a query de move-in no PostgreSQL:

```sql
SELECT key, ARRAY[tags]::text[], json_row
FROM child
WHERE parent_id = ANY($1::text[]::uuid[])
```

O `ARRAY[tags]` é gerado por `make_tags/3`, que produz expressões SQL tipo:

```sql
md5('stack_idshape_handle' ||
    CASE WHEN "parent_id"::text IS NULL THEN 'NULL' ELSE 'v:' || "parent_id"::text END)
```

Isto garante que os tags gerados no SQL são **idênticos** aos gerados no Elixir por
`SubqueryMoves.make_value_hash/3`.

### 4.8. PartialModes (`partial_modes.ex`)

#### `query_move_in_async/6`

1. Lança um `Task.Supervisor.start_child`
2. Dentro da task:
   - Executa `SnapshotQuery.execute_for_shape` (obtém snapshot PG consistente)
   - `snapshot_info_fn`: Envia `{:pg_snapshot_known, name, snapshot}` ao consumer **imediatamente**
   - `query_fn`: Executa `Querying.query_move_in`, streama resultados para temp storage
   - Envia `{:query_move_in_complete, name, key_set, snapshot}` ao consumer

---

## 5. Sistema de Tags

### 5.1. O que é um Tag?

Um **tag** é um hash MD5 que codifica a **razão** pela qual uma row pertence a uma shape.
Especificamente, identifica o valor da coluna de ligação (sublink) que causou a inclusão.

### 5.2. Formato do Tag

```
tag = MD5(stack_id + shape_handle + namespaced_value)
```

Onde `namespaced_value`:
- Para `NULL`: `"NULL"` (sem prefixo)
- Para outros valores: `"v:" + valor_como_string`

Para **composite keys** (ex: `(col_a, col_b) IN (...)`):

```
namespaced_value = "col_a:" + namespace(val_a) + "col_b:" + namespace(val_b)
```

### 5.3. Tag Structure

Definida pela shape, diz quais colunas participam na geração de tags:

```elixir
# Single column: parent_id IN (SELECT id FROM ...)
tag_structure = [["parent_id"]]

# Composite: (a, b) IN (SELECT x, y FROM ...)
tag_structure = [[{:hash_together, ["a", "b"]}]]
```

### 5.4. Onde os Tags Aparecem

#### No servidor (`shape.ex:fill_move_tags/4`)

Cada change que passa pelo Consumer recebe tags:

- **NewRecord**: `move_tags: ["abc123..."]`
- **UpdatedRecord**: `move_tags: ["abc123..."]`, `removed_move_tags: ["def456..."]` (se o sublink mudou)
- **DeletedRecord**: `move_tags: ["abc123..."]`

#### No protocolo HTTP/SSE

Os tags viajam nos headers da mensagem:

```json
{
  "key": "\"public\".\"child\"/\"1\"",
  "value": {"id": "1", "parent_id": "p1", "value": "test"},
  "headers": {
    "operation": "insert",
    "relation": ["public", "child"],
    "tags": ["a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4"],
    "removed_tags": []
  }
}
```

### 5.5. Consistência SQL ↔ Elixir

É **crítico** que o cálculo de tags em SQL (para queries de snapshot e move-in) e em Elixir
(para changes do WAL) produzam o mesmo resultado.

**SQL** (`querying.ex`):
```sql
md5('stack_id' || 'shape_handle' ||
    CASE WHEN "parent_id"::text IS NULL THEN 'NULL'
         ELSE 'v:' || "parent_id"::text END)
```

**Elixir** (`subquery_moves.ex`):
```elixir
:crypto.hash(:md5, "#{stack_id}#{shape_handle}#{namespace_value(value)}")
|> Base.encode16(case: :lower)
```

---

## 6. Servidor vs Cliente

### 6.1. Responsabilidades do Servidor

| Componente | Responsabilidade |
|---|---|
| **Consumer** | Gere o ciclo de vida da shape, processa WAL changes, coordena move-ins/outs |
| **Materializer** | Materializa valores da subquery, detecta move-in/out via contagem de referências |
| **SubqueryMoves** | Gera WHERE clauses transformadas, calcula tags, gera padrões de move-out |
| **MoveIns** | Máquina de estados de move-ins (waiting → filtering → completed) |
| **MoveHandling** | Orquestra queries assíncronas e escrita no log |
| **ChangeHandling** | Filtra changes duplicados, detecta mudanças de sublink |
| **Querying** | Executa queries SQL com cálculo de tags no lado do PG |
| **PartialModes** | Execução assíncrona de queries de move-in com snapshot tracking |
| **Shape Log** | Armazena changes, control messages, e move-in snapshots |

**O servidor NÃO sabe quais rows o cliente tem.** Envia tags com cada change e padrões de
move-out nos control messages. É o cliente que decide quais rows remover.

### 6.2. Responsabilidades do Cliente (Elixir Client)

| Componente | Responsabilidade |
|---|---|
| **Poll** | Faz requests HTTP ao servidor, processa respostas |
| **TagTracker** | Mantém índices `tag→keys` e `key→{tags, msg}` |
| **Message** | Define tipos de mensagem (ChangeMessage, MoveOutMessage, ControlMessage) |
| **ShapeState** | Estado da shape no cliente (offset, up_to_date, etc.) |

#### Fluxo no Cliente (`poll.ex`)

```elixir
# 1. Parse das mensagens do servidor
messages = Enum.flat_map(body, &Message.parse(&1, handle, mapper, timestamp))

# 2. Processamento sequencial
Enum.reduce(messages, {[], state}, fn msg, {msgs_acc, state_acc} ->
  case handle_message(msg, state_acc) do
    {:message, processed_msg, new_state} -> ...
    {:messages, processed_msgs, new_state} -> ...  # synthetic deletes
    {:skip, new_state} -> ...                       # snapshot-end
  end
end)
```

#### TagTracker — Update (`tag_tracker.ex`)

Para cada ChangeMessage recebida:

```elixir
def update_tag_index(tag_to_keys, key_data, msg) do
  new_tags = msg.headers.tags
  removed_tags = msg.headers.removed_tags

  updated_tags = (current_tags - removed_tags) ∪ new_tags

  # Para deletes: remover a key completamente
  # Para inserts/updates: atualizar índices bidirecionais
end
```

#### TagTracker — Synthetic Deletes (`tag_tracker.ex`)

Quando recebe um MoveOutMessage:

```elixir
def generate_synthetic_deletes(tag_to_keys, key_data, patterns, timestamp) do
  # 1. Para cada pattern, encontrar keys com esse tag
  # 2. Remover o tag de cada key encontrada
  # 3. Se key fica sem tags → gerar synthetic DELETE
  # 4. Se key ainda tem tags → manter (pertence via outro parent)
end
```

### 6.3. Protocolo de Mensagens

```
Servidor → Cliente:
  ┌──────────────────────────────────────────────────────────────┐
  │ ChangeMessage                                                │
  │   key: "\"public\".\"child\"/\"1\""                          │
  │   value: {id: "1", parent_id: "p1", value: "hello"}         │
  │   headers:                                                   │
  │     operation: "insert" | "update" | "delete"                │
  │     relation: ["public", "child"]                            │
  │     tags: ["a1b2c3..."]          ← porquê esta row está aqui │
  │     removed_tags: ["d4e5f6..."]  ← tags já não válidos       │
  └──────────────────────────────────────────────────────────────┘

  ┌──────────────────────────────────────────────────────────────┐
  │ MoveOutMessage (evento)                                      │
  │   headers:                                                   │
  │     event: "move-out"                                        │
  │     patterns: [{pos: 0, value: "a1b2c3..."}]                 │
  │                  ↑                    ↑                      │
  │               posição no            hash MD5 do              │
  │               tag_structure         valor removido           │
  └──────────────────────────────────────────────────────────────┘

  ┌──────────────────────────────────────────────────────────────┐
  │ ControlMessage                                               │
  │   headers:                                                   │
  │     control: "up-to-date" | "snapshot-end" | "must-refetch"  │
  │     xmin, xmax, xip_list  ← (para snapshot-end)             │
  └──────────────────────────────────────────────────────────────┘
```

### 6.4. Resumo de Interacção Servidor-Cliente

```
                    SERVIDOR                           CLIENTE
              ┌─────────────────┐               ┌─────────────────┐
              │                 │               │                 │
  WAL ──────▶ │ Consumer        │               │  Poll/Stream    │
              │  ├─ Change      │  HTTP/SSE     │  ├─ Parse msgs  │
              │  │  Handling    │──────────────▶│  ├─ TagTracker  │
              │  ├─ Move        │  Changes +    │  │  .update()   │
              │  │  Handling    │  Tags +       │  ├─ TagTracker  │
              │  └─ MoveIns     │  MoveOut      │  │  .generate_  │
              │                 │  Events       │  │   synthetic_ │
              │ Materializer   │               │  │   deletes()  │
              │  ├─ value_count │               │  └─ Emit to    │
              │  ├─ tag_indices │               │     consumer   │
              │  └─ subscribers │               │                 │
              └─────────────────┘               └─────────────────┘

  Tags calculados no servidor                   Tags rastreados no cliente
  (SQL + Elixir, DEVEM ser iguais)              (para saber quando gerar
                                                 synthetic deletes)
```

### 6.5. Feature Flags

O sistema de subqueries requer feature flags:

- `allow_subqueries` — Permite o parsing de subqueries nas WHERE clauses
- `tagged_subqueries` — Habilita o sistema de tags e move-in/move-out causalmente correcto

Sem `tagged_subqueries`, a shape é simplesmente invalidada (stop_and_clean) quando há
move-ins ou move-outs, forçando o cliente a fazer refetch.

### 6.6. ResumeMessage (Cliente Elixir)

O cliente pode pausar e retomar um stream, preservando o estado de tags:

```elixir
defstruct [
  :shape_handle,
  :offset,
  :schema,
  tag_to_keys: %{},  # Estado do TagTracker preservado
  key_data: %{}       # Para continuar a gerar synthetic deletes
]
```

Isto permite que o cliente retome sem perder o contexto de quais rows pertencem à shape por quais tags.

---

## Apêndice: Ficheiros Chave

| Ficheiro | Descrição |
|----------|-----------|
| `sync-service/lib/electric/shapes/shape/subquery_moves.ex` | Tag generation, WHERE transform, move-out patterns |
| `sync-service/lib/electric/shapes/consumer/move_ins.ex` | Move-in state machine |
| `sync-service/lib/electric/shapes/consumer/move_handling.ex` | Move-in/out orchestration |
| `sync-service/lib/electric/shapes/consumer/change_handling.ex` | Change filtering with move-in awareness |
| `sync-service/lib/electric/shapes/consumer/materializer.ex` | Value materialization, reference counting |
| `sync-service/lib/electric/shapes/consumer.ex` | GenServer principal da shape |
| `sync-service/lib/electric/shapes/querying.ex` | SQL query execution with tag computation |
| `sync-service/lib/electric/shapes/partial_modes.ex` | Async move-in query execution |
| `sync-service/lib/electric/shapes/shape.ex` | Shape struct, tag filling, change conversion |
| `elixir-client/lib/electric/client/tag_tracker.ex` | Client-side tag tracking + synthetic deletes |
| `elixir-client/lib/electric/client/message.ex` | Message types (ChangeMessage, MoveOutMessage, etc.) |
| `elixir-client/lib/electric/client/poll.ex` | Polling API with move-out handling |
