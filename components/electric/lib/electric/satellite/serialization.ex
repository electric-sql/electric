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

  @spec supported_pg_types :: [atom]
  def supported_pg_types do
    ~w[
      int2 int4 int8
      float8
      text
      varchar
    ]a
  end

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
            do: raise("Got DDL transaction with differing migration versions")

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
    Enum.map(columns, fn %{name: name, type: type, nullable?: nullable?} ->
      %SatRelationColumn{
        name: name,
        type: to_string(type),
        is_nullable: nullable?,
        primaryKey: MapSet.member?(pks, name)
      }
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
         %SatOpUpdate{row_data: row_data, old_row_data: nil, tags: tags},
         columns
       ) do
    %UpdatedRecord{
      record: decode_record(row_data, columns, :allow_nulls),
      old_record: nil,
      tags: tags
    }
  end

  defp op_to_change(
         %SatOpUpdate{row_data: row_data, old_row_data: old_row_data, tags: tags},
         columns
       ) do
    %UpdatedRecord{
      record: decode_record(row_data, columns),
      old_record: decode_record(old_row_data, columns),
      tags: tags
    }
  end

  defp op_to_change(%SatOpDelete{old_row_data: nil, tags: tags}, _columns) do
    %DeletedRecord{old_record: nil, tags: tags}
  end

  defp op_to_change(%SatOpDelete{old_row_data: old_row_data, tags: tags}, columns) do
    %DeletedRecord{
      old_record: decode_record(old_row_data, columns),
      tags: tags
    }
  end

  @spec decode_record(%SatOpRow{}, [String.t()], :allow_nulls | nil) ::
          %{String.t() => nil | String.t()} | nil
  def decode_record(row, columns) do
    decode_record(row, columns, nil)
  end

  defp decode_record(nil, _columns, _opt) do
    raise "protocol violation, empty row"
  end

  defp decode_record(%SatOpRow{nulls_bitmask: bitmask, values: values}, columns, opt) do
    decode_values(values, bitmask, columns, opt)
    |> Map.new()
  end

  defp decode_values([], _bitmask, [], _opt), do: []

  defp decode_values([val | values], <<0::1, bitmask::bits>>, [col | columns], opt)
       when is_binary(val) do
    [
      {col.name, decode_column_value(val, col.type)}
      | decode_values(values, bitmask, columns, opt)
    ]
  end

  defp decode_values(_, <<1::1, _::bits>>, [%{nullable?: false} | _], opt)
       when opt != :allow_nulls do
    raise "protocol violation, null value for a not null column"
  end

  defp decode_values(["" | values], <<1::1, bitmask::bits>>, [col | columns], opt) do
    [{col.name, nil} | decode_values(values, bitmask, columns, opt)]
  end

  @doc """
  Given a column value received from a Satellite client, transcode it into the format that can be fed into Postgres'
  logical replication stream (aka "server-native format").
  """
  @spec decode_column_value(binary, atom) :: binary

  def decode_column_value(val, type) when type in [:bytea, :text, :varchar] do
    val
  end

  def decode_column_value(val, type) when type in [:int2, :int4, :int8] do
    :ok =
      val
      |> String.to_integer()
      |> assert_integer_in_range!(type)

    val
  end

  def decode_column_value(val, :float8) do
    _ = String.to_float(val)
    val
  end

  def decode_column_value(val, :uuid) do
    {:ok, uuid} = Electric.Utils.validate_uuid(val)
    uuid
  end

  @int2_range -32768..32767
  @int4_range -2_147_483_648..2_147_483_647
  @int8_range -9_223_372_036_854_775_808..9_223_372_036_854_775_807

  defp assert_integer_in_range!(int, :int2) when int in @int2_range, do: :ok
  defp assert_integer_in_range!(int, :int4) when int in @int4_range, do: :ok
  defp assert_integer_in_range!(int, :int8) when int in @int8_range, do: :ok
end
