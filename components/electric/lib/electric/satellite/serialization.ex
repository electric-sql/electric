defmodule Electric.Satellite.Serialization do
  alias Electric.Postgres.{Extension, Replication}
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
          %{Changes.relation() => {PB.relation_id(), [Replication.Column.name()]}}

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
              raise(RuntimeError,
                message: "Got DDL transaction with differing migration versions"
              )

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
    %{
      ops: ops,
      new_relations: new_relations,
      known_relations: known_relations
    } = state

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
    %{oid: relation_id, columns: columns} = fetch_relation(relation)
    column_names = for %{name: column_name} <- columns, do: column_name

    {relation_id, column_names, Map.put(known_relations, relation, {relation_id, column_names})}
  end

  defp fetch_relation(relation) do
    Extension.SchemaCache.Global.relation!(relation)
  end

  @doc """
  Serialize internal relation representation to Satellite PB format
  """
  @spec serialize_relation(Replication.Table.t()) :: %SatRelation{}
  def serialize_relation(%Replication.Table{} = table) do
    %SatRelation{
      schema_name: table.schema,
      table_type: :TABLE,
      table_name: table.name,
      relation_id: table.oid,
      columns: serialize_table_columns(table.columns, MapSet.new(table.primary_keys))
    }
  end

  defp serialize_table_columns(columns, pks) do
    Enum.map(columns, fn %{name: name, type: type} ->
      %SatRelationColumn{name: name, type: to_string(type), primaryKey: MapSet.member?(pks, name)}
    end)
  end

  @type cached_relations() :: %{
          PB.relation_id() => %{
            schema: String.t(),
            table: String.t(),
            columns: [String.t()]
          }
        }

  @doc """
  Deserialize from Satellite PB format to internal format
  """
  @spec deserialize_trans(
          String.t(),
          %SatOpLog{},
          %Transaction{} | nil,
          cached_relations(),
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
        relation = Map.get(relations, relation_id)

        change =
          op
          |> op_to_change(relation.columns)
          |> Map.put(:relation, {relation.schema, relation.table})

        {%Transaction{trans | changes: [change | trans.changes]}, complete}
    end)
  end

  defp op_to_change(%SatOpInsert{row_data: row_data, tags: tags}, columns) do
    %NewRecord{record: decode_record(row_data, columns), tags: tags}
  end

  defp op_to_change(
         %SatOpUpdate{row_data: row_data, old_row_data: old_row_data, tags: tags},
         columns
       ) do
    %UpdatedRecord{
      record: decode_record(row_data, columns),
      old_record: decode_record(old_row_data, columns, :allow_empty_row),
      tags: tags
    }
  end

  defp op_to_change(%SatOpDelete{old_row_data: old_row_data, tags: tags}, columns) do
    %DeletedRecord{
      old_record: decode_record(old_row_data, columns, :allow_empty_row),
      tags: tags
    }
  end

  @spec decode_record(%SatOpRow{}, [String.t()], :allow_empty_row | nil) ::
          %{
            String.t() => nil | String.t()
          }
          | nil
  def decode_record(row, columns) do
    decode_record(row, columns, nil)
  end

  defp decode_record(nil, _columns, :allow_empty_row), do: nil

  defp decode_record(nil, _columns, nil) do
    raise "protocol violation, empty row"
  end

  defp decode_record(%SatOpRow{} = row, columns, _) do
    column_types = Enum.map(columns, &String.to_existing_atom(&1.type))
    column_names = Enum.map(columns, & &1.name)
    row |> validate_values!(column_types) |> row_to_map(column_names)
  end

  defp validate_values!(%SatOpRow{nulls_bitmask: bitmask, values: values} = row, column_types) do
    Enum.each(Enum.zip([column_types, values, bitmask_to_boolean(bitmask)]), fn
      {_type, _val, true = _null?} ->
        :ok

      {type, val, false = _null?} when is_binary(val) ->
        Electric.Satellite.Validation.assert_type!(val, type)
    end)

    row
  end

  defp bitmask_to_boolean(bitmask) do
    for <<b::1 <- bitmask>>, do: b == 1
  end

  def row_to_map(%SatOpRow{nulls_bitmask: bitmask, values: values}, column_names) do
    Enum.zip(column_names, apply_nulls_bitmask(values, bitmask))
    |> Map.new()
  end

  defp apply_nulls_bitmask([v | vals], <<0::1, bitmask::bitstring>>),
    do: [v | apply_nulls_bitmask(vals, bitmask)]

  defp apply_nulls_bitmask([_ | vals], <<1::1, bitmask::bitstring>>),
    do: [nil | apply_nulls_bitmask(vals, bitmask)]

  defp apply_nulls_bitmask([], _), do: []
end
