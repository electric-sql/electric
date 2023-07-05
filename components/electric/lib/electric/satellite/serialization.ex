defmodule Electric.Satellite.Serialization do
  alias Electric.Postgres.{Extension, Replication, SchemaRegistry}
  alias Electric.Replication.Changes

  alias Electric.Replication.Changes.{
    Transaction,
    NewRecord,
    UpdatedRecord,
    DeletedRecord
  }

  use Electric.Satellite.Protobuf

  import Electric.Postgres.Extension,
    only: [is_migration_relation: 1, is_ddl_relation: 1, is_extension_relation: 1]

  require Logger

  @type relation_mapping() ::
          %{Changes.relation() => {PB.relation_id(), [SchemaRegistry.column_name()]}}

  @doc """
  Serialize from internal format to Satellite PB format
  """
  @spec serialize_trans(Transaction.t(), term(), relation_mapping()) ::
          {[%SatOpLog{}], [Changes.relation()], relation_mapping()}
  def serialize_trans(%Transaction{} = trans, offset, known_relations) do
    tm = DateTime.to_unix(trans.commit_timestamp, :millisecond)
    lsn = Electric.Postgres.CachedWal.Api.serialize_wal_position(offset)

    state = %{
      ops: [],
      origin: trans.origin,
      is_migration: false,
      migration_version: nil,
      schema: nil,
      new_relations: [],
      known_relations: known_relations
    }

    state = Enum.reduce(trans.changes, state, &serialize_change/2)

    case state.ops do
      [] ->
        {
          [],
          state.new_relations,
          state.known_relations
        }

      [_ | _] = ops ->
        tx_begin = %SatOpBegin{
          commit_timestamp: tm,
          lsn: lsn,
          origin: trans.origin,
          is_migration: state.is_migration
        }

        begin_op = %SatTransOp{op: {:begin, tx_begin}}
        commit_op = %SatTransOp{op: {:commit, %SatOpCommit{commit_timestamp: tm, lsn: lsn}}}

        {
          [%SatOpLog{ops: [begin_op | Enum.reverse([commit_op | ops])]}],
          state.new_relations,
          state.known_relations
        }
    end
  end

  def serialize_shape_data_as_tx(changes, known_relations) do
    state = %{
      ops: [],
      new_relations: [],
      known_relations: known_relations
    }

    # The changes cannot be migration relations, so our "state" is limited
    state = Enum.reduce(changes, state, &serialize_change/2)

    {[%SatOpLog{ops: state.ops}], state.new_relations, state.known_relations}
  end

  defp serialize_change(record, state) when is_migration_relation(record.relation) do
    %{
      origin: origin,
      schema: schema,
      ops: ops,
      migration_version: version,
      new_relations: new_relations
    } = state

    state =
      case(record) do
        ddl when is_ddl_relation(ddl.relation) ->
          {:ok, v, sql} = Extension.extract_ddl_version(ddl.record)

          Logger.info("Serializing migration #{inspect(v)}: #{inspect(sql)}")

          # unlikely since the extension tables have constraints that prevent this
          if version && version != v,
            do:
              raise(RuntimeError, message: "Got DDL transaction with differing migration versions")

          {:ok, schema} = maybe_load_schema(origin, schema, v)

          {ops, add_relations} =
            case Replication.migrate(schema, v, sql) do
              {:ok, [op], relations} ->
                {[%SatTransOp{op: {:migrate, op}} | ops], relations}

              {:ok, [], []} ->
                {ops, []}
            end

          known_relations =
            Enum.reduce(add_relations, state.known_relations, fn relation, known ->
              {_relation_id, _column_names, known} = load_new_relation(relation, known)

              known
            end)

          %{
            state
            | ops: ops,
              migration_version: v,
              schema: schema,
              new_relations: new_relations ++ add_relations,
              known_relations: known_relations
          }

        _ ->
          state
      end

    %{state | is_migration: true}
  end

  # writes to any table under the electric.* schema shoudn't be passed as DML
  defp serialize_change(record, state) when is_extension_relation(record.relation) do
    state
  end

  defp serialize_change(record, state) do
    %{ops: ops, new_relations: new_relations, known_relations: known_relations} = state

    relation = record.relation

    {rel_id, rel_cols, new_relations, known_relations} =
      case fetch_relation_id(relation, known_relations) do
        {:new, {relation_id, columns, known}} ->
          {relation_id, columns, [relation | new_relations], known}

        {:existing, {relation_id, columns}} ->
          {relation_id, columns, new_relations, known_relations}
      end

    op = mk_trans_op(record, rel_id, rel_cols)

    %{state | ops: [op | ops], new_relations: new_relations, known_relations: known_relations}
  end

  defp maybe_load_schema(origin, nil, version) do
    with {:ok, _version, schema} <- Extension.SchemaCache.load(origin, version) do
      {:ok, schema}
    else
      error ->
        Logger.error("#{origin} Unable to load schema version #{version}: #{inspect(error)}")
        error
    end
  end

  defp maybe_load_schema(_origin, schema, _version) do
    {:ok, schema}
  end

  defp mk_trans_op(%NewRecord{record: data, tags: tags}, rel_id, rel_cols) do
    op_insert = %SatOpInsert{
      relation_id: rel_id,
      row_data: map_to_row(data, rel_cols),
      tags: tags
    }

    %SatTransOp{op: {:insert, op_insert}}
  end

  defp mk_trans_op(
         %UpdatedRecord{record: data, old_record: old_data, tags: tags},
         rel_id,
         rel_cols
       ) do
    op_update = %SatOpUpdate{
      relation_id: rel_id,
      row_data: map_to_row(data, rel_cols),
      old_row_data: map_to_row(old_data, rel_cols),
      tags: tags
    }

    %SatTransOp{op: {:update, op_update}}
  end

  defp mk_trans_op(%DeletedRecord{old_record: data, tags: tags}, rel_id, rel_cols) do
    op_delete = %SatOpDelete{
      relation_id: rel_id,
      old_row_data: map_to_row(data, rel_cols),
      tags: tags
    }

    %SatTransOp{op: {:delete, op_delete}}
  end

  @spec map_to_row(%{String.t() => binary()} | nil, [String.t()]) :: %SatOpRow{}
  def map_to_row(nil, _), do: nil

  def map_to_row(data, rel_cols) when is_list(rel_cols) and is_map(data) do
    bitmask = []
    values = []

    {num_columns, bitmask, values} =
      Enum.reduce(rel_cols, {0, bitmask, values}, fn column_name, {num, bitmask0, values0} ->
        # FIXME: This is inefficient, data should be stored in order, so that we
        # do not have to do lookup here, but filter columns based on the schema instead
        case Map.get(data, column_name, nil) do
          nil ->
            {num + 1, [1 | bitmask0], [<<>> | values0]}

          value when is_binary(value) ->
            {num + 1, [0 | bitmask0], [value | values0]}
        end
      end)

    bitmask =
      case rem(num_columns, 8) do
        0 -> bitmask
        n -> :lists.duplicate(8 - n, 0) ++ bitmask
      end

    bitmask = for i <- Enum.reverse(bitmask), do: <<i::1>>, into: <<>>

    %SatOpRow{nulls_bitmask: bitmask, values: Enum.reverse(values)}
  end

  def fetch_relation_id(relation, known_relations) do
    case Map.get(known_relations, relation, nil) do
      nil ->
        {:new, load_new_relation(relation, known_relations)}

      {relation_id, columns} ->
        {:existing, {relation_id, columns}}
    end
  end

  defp load_new_relation(relation, known_relations) do
    {%{oid: relation_id}, columns} = fetch_relation(relation)
    column_names = for %{name: column_name} <- columns, do: column_name

    {relation_id, column_names, Map.put(known_relations, relation, {relation_id, column_names})}
  end

  defp fetch_relation(relation) do
    table = SchemaRegistry.fetch_table_info!(relation)

    {table, SchemaRegistry.fetch_table_columns!(relation)}
  end

  @doc """
  Serialize internal relation representation to Satellite PB format
  """
  # @spec serialize_relation(String.t(), String.t(), integer(), [SchemaRegistry.column()]) ::
  #         %SatRelation{}
  # def serialize_relation(schema, name, oid, columns) do
  @spec serialize_relation(SchemaRegistry.replicated_table(), [SchemaRegistry.column()]) ::
          %SatRelation{}
  def serialize_relation(table_info, columns) do
    %SatRelation{
      schema_name: table_info.schema,
      table_type: :TABLE,
      table_name: table_info.name,
      relation_id: table_info.oid,
      columns: serialize_columns(columns, MapSet.new(table_info.primary_keys), [])
    }
  end

  defp serialize_columns([%{name: name_str, type: type_atom} | rest], pks, acc) do
    serialize_columns(
      rest,
      pks,
      [
        %SatRelationColumn{
          name: name_str,
          type: :erlang.atom_to_binary(type_atom),
          primaryKey: MapSet.member?(pks, name_str)
        }
        | acc
      ]
    )
  end

  defp serialize_columns([], _pks, acc) do
    Enum.reverse(acc)
  end

  @doc """
  Deserialize from Satellite PB format to internal format
  """
  @spec deserialize_trans(
          String.t(),
          %SatOpLog{},
          %Transaction{} | nil,
          %{
            PB.relation_id() => %{
              :schema => String.t(),
              :table => String.t(),
              :columns => [String.t()]
            }
          },
          (term -> any)
        ) ::
          {
            incomplete :: %Transaction{} | nil,
            # Complete transactions are send in reverse order
            complete :: [%Transaction{}]
          }
  def deserialize_trans(origin, %SatOpLog{} = op_log, nil, relations, ack_fun) do
    deserialize_op_log(origin, op_log, {nil, []}, relations, ack_fun)
  end

  def deserialize_trans(origin, %SatOpLog{} = op_log, %Transaction{} = trans, relations, ack_fun)
      when origin !== "" do
    deserialize_op_log(origin, op_log, {trans, []}, relations, ack_fun)
  end

  defp deserialize_op_log(origin, %SatOpLog{} = msg, incomplete, relations, ack_fun) do
    Enum.reduce(msg.ops, incomplete, fn
      %SatTransOp{op: {:begin, %SatOpBegin{} = op}}, {nil, complete} ->
        {:ok, dt} = DateTime.from_unix(op.commit_timestamp, :millisecond)

        if op.lsn == "" do
          raise "lsn is empty in begin operation"
        end

        trans = %Transaction{
          origin: origin,
          origin_type: :satellite,
          changes: [],
          publication: "",
          commit_timestamp: dt,
          lsn: op.lsn,
          ack_fn: fn -> ack_fun.(op.lsn) end
        }

        {trans, complete}

      %SatTransOp{op: {:commit, %SatOpCommit{} = _op}}, {trans, complete} ->
        trans = %Transaction{trans | changes: Enum.reverse(trans.changes)}
        {nil, [trans | complete]}

      %SatTransOp{op: {_, %{relation_id: relation_id} = op}}, {trans, complete} ->
        relation = fetch_relation(relations, relation_id)

        transop =
          case op do
            %SatOpInsert{row_data: row_data, tags: tags} ->
              data = row_to_map(relation.columns, row_data, false)
              %NewRecord{relation: {relation.schema, relation.table}, record: data, tags: tags}

            %SatOpUpdate{row_data: row_data, old_row_data: old_row_data, tags: tags} ->
              old_data = row_to_map(relation.columns, old_row_data, true)
              data = row_to_map(relation.columns, row_data, false)

              %UpdatedRecord{
                relation: {relation.schema, relation.table},
                record: data,
                old_record: old_data,
                tags: tags
              }

            %SatOpDelete{old_row_data: old_row_data, tags: tags} ->
              old_data = row_to_map(relation.columns, old_row_data, true)

              %DeletedRecord{
                relation: {relation.schema, relation.table},
                old_record: old_data,
                tags: tags
              }
          end

        {%Transaction{trans | changes: [transop | trans.changes]}, complete}
    end)
  end

  defp fetch_relation(relations, relation_id) do
    Map.get(relations, relation_id)
  end

  @spec row_to_map([String.t()], %SatOpRow{}) :: %{String.t() => nil | String.t()}
  def row_to_map(columns, row) do
    row_to_map(columns, row, false)
  end

  defp row_to_map(_columns, nil, false) do
    raise "protocol violation, empty row"
  end

  defp row_to_map(_columns, nil, true), do: nil

  defp row_to_map(columns, %SatOpRow{nulls_bitmask: bitmask, values: values}, _) do
    bitmask_list = for <<x::1 <- bitmask>>, do: x

    {row, _, []} =
      Enum.reduce(columns, {%{}, bitmask_list, values}, fn
        column, {map0, [0 | bitmask_list0], [value | values0]} ->
          {Map.put(map0, column, value), bitmask_list0, values0}

        column, {map0, [1 | bitmask_list0], [_ | values0]} ->
          {Map.put(map0, column, nil), bitmask_list0, values0}
      end)

    row
  end
end
