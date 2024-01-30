defmodule Electric.Satellite.Serialization do
  alias Electric.Satellite.Protocol
  alias Electric.Satellite.SatOpGone
  alias Electric.Replication.Changes.Gone
  alias Electric.Postgres.Extension.SchemaCache
  alias Electric.Postgres.{Extension, Replication}
  alias Electric.Replication.Changes

  alias Electric.Replication.Changes.{
    Transaction,
    NewRecord,
    UpdatedRecord,
    DeletedRecord,
    Compensation
  }

  use Electric.Satellite.Protobuf

  import Electric.Postgres.Extension,
    only: [is_migration_relation: 1, is_ddl_relation: 1, is_extension_relation: 1]

  import Bitwise

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

    tx_begin = %SatOpBegin{
      commit_timestamp: tm,
      lsn: lsn,
      origin: trans.origin,
      is_migration: state.is_migration
    }

    tx_commit = %SatOpCommit{
      commit_timestamp: tm,
      lsn: lsn,
      additional_data_ref: trans.additional_data_ref
    }

    begin_op = %SatTransOp{op: {:begin, tx_begin}}
    commit_op = %SatTransOp{op: {:commit, tx_commit}}

    {
      [%SatOpLog{ops: [begin_op | Enum.reverse([commit_op | state.ops])]}],
      state.new_relations,
      state.known_relations
    }
  end

  def serialize_move_in_data_as_tx(ref, changes, known_relations) do
    begin_op = %SatTransOp{op: {:additional_begin, %SatOpAdditionalBegin{ref: ref}}}
    commit_op = %SatTransOp{op: {:additional_commit, %SatOpAdditionalCommit{ref: ref}}}

    state = %{
      ops: [commit_op],
      new_relations: [],
      known_relations: known_relations
    }

    # The changes cannot be migration relations, so our "state" is limited
    state = Enum.reduce(changes, state, &serialize_change/2)

    {[%SatOpLog{ops: [begin_op | state.ops]}], state.new_relations, state.known_relations}
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
          {:ok, v} = SchemaCache.tx_version(origin, ddl.record)
          {:ok, sql} = Extension.extract_ddl_sql(ddl.record)

          Logger.info("Serializing migration #{inspect(v)}: #{inspect(sql)}")

          # unlikely since the extension tables have constraints that prevent this
          if version && version != v,
            do: raise("Got DDL transaction with differing migration versions")

          {:ok, schema_version} = maybe_load_schema(origin, schema, v)

          {ops, add_relations} =
            case Replication.migrate(schema_version, sql) do
              {:ok, [op], relations} ->
                {[%SatTransOp{op: {:migrate, op}} | ops], relations}

              {:ok, [], []} ->
                {ops, []}
            end

          known_relations =
            Enum.reduce(add_relations, state.known_relations, fn relation, known ->
              {_relation_id, _columns, _, known} = load_new_relation(relation, known)
              known
            end)

          %{
            state
            | ops: ops,
              migration_version: v,
              schema: schema_version,
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

    {rel_id, rel_cols, rel_pks, new_relations, known_relations} =
      case fetch_relation_id(relation, known_relations) do
        {:new, {relation_id, columns, pks, known_relations}} ->
          {relation_id, columns, pks, [relation | new_relations], known_relations}

        {:existing, {relation_id, columns, pks}} ->
          {relation_id, columns, pks, new_relations, known_relations}
      end

    op = mk_trans_op(record, rel_id, rel_cols, rel_pks)

    %{state | ops: [op | ops], new_relations: new_relations, known_relations: known_relations}
  end

  defp maybe_load_schema(origin, nil, version) do
    with {:ok, schema} <- Extension.SchemaCache.load(origin, version) do
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

  defp mk_trans_op(%NewRecord{record: data, tags: tags}, rel_id, rel_cols, _) do
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
         rel_cols,
         _
       ) do
    op_update = %SatOpUpdate{
      relation_id: rel_id,
      row_data: map_to_row(data, rel_cols),
      old_row_data: map_to_row(old_data, rel_cols),
      tags: tags
    }

    %SatTransOp{op: {:update, op_update}}
  end

  defp mk_trans_op(%DeletedRecord{old_record: data, tags: tags}, rel_id, rel_cols, _) do
    op_delete = %SatOpDelete{
      relation_id: rel_id,
      old_row_data: map_to_row(data, rel_cols),
      tags: tags
    }

    %SatTransOp{op: {:delete, op_delete}}
  end

  defp mk_trans_op(%Gone{pk: pk}, rel_id, rel_cols, pk_cols) do
    pk_map = Enum.zip(pk_cols, pk) |> Map.new()

    %SatTransOp{
      op: {:gone, %SatOpGone{relation_id: rel_id, pk_data: map_to_row(pk_map, rel_cols)}}
    }
  end

  @spec map_to_row(%{String.t() => binary()} | nil, [map], Keyword.t()) :: %SatOpRow{}
  def map_to_row(data, cols, opts \\ [])

  def map_to_row(data, cols, opts) when is_list(cols) and is_map(data) do
    encode_value_fn =
      if opts[:skip_value_encoding?] do
        fn val, _type -> val end
      else
        &encode_column_value/2
      end

    {values, {bitmask, num_cols}} =
      Enum.map_reduce(cols, {0, 0}, fn col, {bitmask, num_cols} ->
        # FIXME: This is inefficient, data should be stored in order, so that we
        # do not have to do lookup here, but filter columns based on the schema instead
        case Map.get(data, col.name) do
          nil ->
            {"", {bor(bitmask <<< 1, 1), num_cols + 1}}

          val when is_binary(val) ->
            {encode_value_fn.(val, col.type), {bitmask <<< 1, num_cols + 1}}
        end
      end)

    %SatOpRow{nulls_bitmask: encode_nulls_bitmask(bitmask, num_cols), values: values}
  end

  # Values of type `timestamp` are coming over Postgres' logical replication stream in the following form:
  #
  #     2023-08-14 14:01:28.848242
  #
  # We don't need to do conversion on those values before passing them on to Satellite clients, so we let the catch-all
  # function clause handle those. Values of type `timestamptz`, however, are encoded as follows:
  #
  #     2023-08-14 10:01:28.848242+00
  #
  # This is not valid syntax for SQLite's builtin datetime functions and we would like to avoid letting the Satellite
  # protocol propagate Postgres' data formatting quirks to clients. So a minor conversion step is done here to replace
  # `+00` with `Z` so that the whole string becomes conformant with ISO-8601.
  #
  # NOTE: We're ensuring the time zone offset is always `+00` by setting the `timezone` parameter to `'UTC'` before
  # starting the replication stream.
  defp encode_column_value(val, :timestamptz) do
    {:ok, dt, 0} = DateTime.from_iso8601(val)
    DateTime.to_string(dt)
  end

  # No-op encoding for the rest of supported types
  defp encode_column_value(val, _type), do: val

  defp encode_nulls_bitmask(bitmask, num_cols) do
    case rem(num_cols, 8) do
      0 ->
        <<bitmask::size(num_cols)>>

      n ->
        extra_bits = 8 - n
        bitmask = bitmask <<< extra_bits
        <<bitmask::size(num_cols + extra_bits)>>
    end
  end

  def fetch_relation_id(relation, known_relations) do
    case Map.get(known_relations, relation) do
      nil ->
        {:new, load_new_relation(relation, known_relations)}

      {relation_id, columns, pks} ->
        {:existing, {relation_id, columns, pks}}
    end
  end

  defp load_new_relation(relation, known_relations) do
    %{oid: relation_id, columns: columns, primary_keys: pks} = fetch_relation(relation)
    {relation_id, columns, pks, Map.put(known_relations, relation, {relation_id, columns, pks})}
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

  @type cached_relations() :: Protocol.InRep.cached_relations()

  @type additional_data :: {:additional_data, non_neg_integer(), [Changes.change()]}

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
            complete :: [%Transaction{} | additional_data()]
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
      %SatTransOp{op: {:additional_begin, %SatOpAdditionalBegin{}}}, {nil, complete} ->
        {{:additional_data, []}, complete}

      %SatTransOp{op: {:additional_commit, %SatOpAdditionalCommit{ref: ref}}},
      {{:additional_data, changes}, complete} ->
        {nil, [{:additional_data, ref, Enum.reverse(changes)} | complete]}

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

        case trans do
          %Transaction{} = trans ->
            {%Transaction{trans | changes: [change | trans.changes]}, complete}

          {:additional_data, changes} ->
            {{:additional_data, [change | changes]}, complete}
        end
    end)
  end

  defp op_to_change(%SatOpInsert{row_data: row_data, tags: tags}, columns) do
    %NewRecord{record: decode_record!(row_data, columns), tags: tags}
  end

  defp op_to_change(%SatOpCompensation{pk_data: pk_data, tags: tags}, columns) do
    %Compensation{
      record: decode_record!(pk_data, columns, :allow_nulls),
      tags: tags
    }
  end

  defp op_to_change(%SatOpGone{pk_data: data}, columns) do
    record = decode_record!(data, columns, :allow_nulls)

    %Gone{
      pk:
        columns
        |> Enum.reject(&is_nil(&1.pk_position))
        |> Enum.sort_by(& &1.pk_position)
        |> Enum.map(&record[&1.name])
    }
  end

  # TODO: Kept for compatibility with old clients that send a special update for compensation
  # messages. remove once we're sure all clients have been updated.
  defp op_to_change(%SatOpUpdate{row_data: row_data, old_row_data: nil, tags: tags} = op, columns) do
    Logger.warning("Received old-style compensation update #{inspect(op)}")

    %Compensation{
      record: decode_record!(row_data, columns, :allow_nulls),
      tags: tags
    }
  end

  defp op_to_change(
         %SatOpUpdate{row_data: row_data, old_row_data: old_row_data, tags: tags},
         columns
       ) do
    UpdatedRecord.new(
      record: decode_record!(row_data, columns),
      old_record: decode_record!(old_row_data, columns),
      tags: tags
    )
  end

  defp op_to_change(%SatOpDelete{old_row_data: nil, tags: tags}, _columns) do
    %DeletedRecord{old_record: nil, tags: tags}
  end

  defp op_to_change(%SatOpDelete{old_row_data: old_row_data, tags: tags}, columns) do
    %DeletedRecord{
      old_record: decode_record!(old_row_data, columns),
      tags: tags
    }
  end

  @spec decode_record!(%SatOpRow{}, [String.t()], :allow_nulls | nil) ::
          %{String.t() => nil | String.t()} | nil
  def decode_record!(row, columns) do
    decode_record!(row, columns, nil)
  end

  defp decode_record!(nil, _columns, _opt) do
    raise "protocol violation, empty row"
  end

  defp decode_record!(%SatOpRow{nulls_bitmask: bitmask, values: values}, columns, opt) do
    decode_values(values, bitmask, columns, opt)
    |> Map.new()
  end

  defp decode_values([], _bitmask, [], _opt), do: []

  defp decode_values([val | values], <<0::1, bitmask::bits>>, [col | columns], opt)
       when is_binary(val) do
    [
      {col.name, decode_column_value!(val, col.type)}
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
  @spec decode_column_value!(binary, atom) :: binary

  def decode_column_value!(val, :bool) when val in ["t", "f"], do: val

  def decode_column_value!(val, :bool) do
    raise "Unexpected value for bool column: #{inspect(val)}"
  end

  def decode_column_value!(val, type) when type in [:bytea, :text, :varchar] do
    val
  end

  def decode_column_value!(val, :date) do
    <<yyyy::binary-4, ?-, mm::binary-2, ?-, dd::binary-2>> = val

    year = String.to_integer(yyyy)
    assert_valid_year!(year)

    month = String.to_integer(mm)
    assert_valid_month!(month)

    day = String.to_integer(dd)
    assert_valid_day!(day)

    _ = Date.from_iso8601!(val)

    val
  end

  def decode_column_value!(val, type) when type in [:float4, :float8] do
    case String.downcase(val) do
      inf_or_nan when inf_or_nan in ~w[inf infinity -inf -infinity nan] -> val
      _ -> decode_float_value!(val, type)
    end
  end

  def decode_column_value!(val, type) when type in [:int2, :int4, :int8] do
    val
    |> String.to_integer()
    |> assert_valid_integer!(type)

    val
  end

  def decode_column_value!(val, type) when type in [:json, :jsonb] do
    _ = Jason.decode!(val)
    val
  end

  def decode_column_value!(val, :time) do
    <<hh::binary-2, ?:, mm::binary-2, ?:, ss::binary-2>> <> frac = val

    hours = String.to_integer(hh)
    assert_valid_hours!(hours)

    minutes = String.to_integer(mm)
    assert_valid_minutes!(minutes)

    seconds = String.to_integer(ss)
    assert_valid_seconds!(seconds)

    assert_valid_fractional_seconds!(frac)

    _ = Time.from_iso8601!(val)

    val
  end

  def decode_column_value!(val, :timestamp) do
    # NaiveDateTime silently discards time zone offset if it is present in the string. But we want to reject such strings
    # because values of type `timestamp` must not have an offset.
    {:error, :missing_offset} = DateTime.from_iso8601(val)

    dt = NaiveDateTime.from_iso8601!(val)
    assert_valid_year!(dt.year)

    val
  end

  def decode_column_value!(val, :timestamptz) do
    # The offset of datetimes coming over the Satellite protocol MUST be 0.
    len_minus_1 = byte_size(val) - 1
    <<_::binary-size(len_minus_1), "Z">> = val

    {:ok, dt, 0} = DateTime.from_iso8601(val)
    assert_valid_year!(dt.year)

    val
  end

  def decode_column_value!(val, :uuid) do
    Electric.Utils.validate_uuid!(val)
  end

  def decode_column_value!(val, {:enum, typename, values}) do
    if val in values do
      val
    else
      raise "Unexpected value #{inspect(val)} for enum type #{typename}"
    end
  end

  defp decode_float_value!(val, type) do
    case Float.parse(val) do
      {num, ""} ->
        assert_float_in_range!(num, type)
        val

      _ ->
        raise "Unexpected value for #{type} colum: #{inspect(val)}"
    end
  end

  @int2_range -32768..32767
  @int4_range -2_147_483_648..2_147_483_647
  @int8_range -9_223_372_036_854_775_808..9_223_372_036_854_775_807

  defp assert_valid_integer!(int, :int2) when int in @int2_range, do: :ok
  defp assert_valid_integer!(int, :int4) when int in @int4_range, do: :ok
  defp assert_valid_integer!(int, :int8) when int in @int8_range, do: :ok

  # Postgres[1] uses BC/AD suffixes to indicate whether the date is in the Common Era or precedes it. Postgres assumes year
  # 0 did not exist, so in its worldview '0001-12-31 BC' is immediately followed by '0001-01-01'.
  #
  # In SQLite[2], the builtin functions for working with dates and times only work for dates between '0001-01-01 00:00:00'
  # and '9999-12-31 23:59:59'.
  #
  # To be conservative in our validations and not let invalid values slip through by accident, we're limiting the range
  # of supported dates to start on '0001-01-01` and end on '9999-12-31'. This applies to :date, :timestamp, and
  # :timestamptz types.
  #
  #   [1]: https://www.postgresql.org/docs/current/datatype-datetime.html
  #   [2]: https://www.sqlite.org/lang_datefunc.html
  defp assert_valid_year!(year) when year in 1..9999, do: :ok

  defp assert_valid_month!(month) when month in 1..12, do: :ok

  defp assert_valid_day!(day) when day in 1..31, do: :ok

  defp assert_valid_hours!(hours) when hours in 0..23, do: :ok

  defp assert_valid_minutes!(minutes) when minutes in 0..59, do: :ok

  defp assert_valid_seconds!(seconds) when seconds in 0..59, do: :ok

  defp assert_valid_fractional_seconds!(""), do: :ok

  # Fractional seconds must not exceed 6 decimal digits, otherwise Postgres will round client's value.
  defp assert_valid_fractional_seconds!("." <> fs_str) when byte_size(fs_str) <= 6 do
    _ = String.to_integer(fs_str)
    :ok
  end

  defp assert_float_in_range!(_num, :float8), do: :ok

  defp assert_float_in_range!(num, :float4) do
    conversion_result =
      case <<num::float-32>> do
        <<_sign::1, 0xFF, 0::23>> ->
          # The input is rounded up to Infinity when converted to a 32-bit floating point number.
          # It should have been encoded as literal "Infinity" by the client.
          :error

        <<_sign::1, 0, 0::23>> when num != 0 ->
          # The input is rounded down to zero. It should have been encoded as literal "0" by the client.
          :error

        _ ->
          :ok
      end

    with :error <- conversion_result do
      raise "Value for float4 column out of range: #{inspect(num)}"
    end
  end
end
