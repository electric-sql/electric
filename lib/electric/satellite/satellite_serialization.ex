defmodule Electric.Satellite.Serialization do
  alias Electric.Satellite.{
    SatOpLog,
    SatOpRow,
    SatTransOp,
    SatOpBegin,
    SatOpUpdate,
    SatOpDelete,
    SatOpInsert,
    SatOpCommit,
    SatRelation,
    SatRelationColumn
  }

  alias Electric.Postgres.SchemaRegistry
  alias Electric.Replication.Changes

  alias Electric.Replication.Changes.{
    Transaction,
    NewRecord,
    UpdatedRecord,
    DeletedRecord
  }

  alias Electric.Satellite.PB.Utils, as: PB

  @type relation_mapping() ::
          %{Changes.relation() => PB.relation_id()}

  @doc """
  Serialize from internal format to Satellite PB format
  """
  @spec serialize_trans(Transaction.t(), term(), relation_mapping()) ::
          {%SatOpLog{}, [Changes.relation()], relation_mapping()}
  def serialize_trans(%Transaction{} = trans, vx_offset, known_relations) do
    tm =
      trans.commit_timestamp
      |> DateTime.to_unix(:millisecond)

    lsn = :erlang.term_to_binary(vx_offset)

    tx_begin = %SatTransOp{
      op: {:begin, %SatOpBegin{commit_timestamp: tm, lsn: lsn}}
    }

    tx_end = %SatTransOp{
      op: {:commit, %SatOpCommit{commit_timestamp: tm, lsn: lsn}}
    }

    {ops, new_relations, known_relations} =
      Enum.reduce(trans.changes, {[tx_begin], [], known_relations}, fn record,
                                                                       {ops, new_relations,
                                                                        known_relations1} ->
        relation = record.relation

        {rel_id, rel_cols, new_relations, known_relations1} =
          case fetch_relation_id(relation, known_relations1) do
            {:new, relation_id, columns, known_relations2} ->
              {relation_id, columns, [relation | new_relations], known_relations2}

            {:existing, relation_id, columns} ->
              {relation_id, columns, new_relations, known_relations1}
          end

        op = mk_trans_op(record, rel_id, rel_cols)

        {[op | ops], new_relations, known_relations1}
      end)

    {%SatOpLog{ops: Enum.reverse([tx_end | ops])}, new_relations, known_relations}
  end

  defp mk_trans_op(%NewRecord{record: data}, rel_id, rel_cols) do
    op_insert = %SatOpInsert{relation_id: rel_id, row_data: map_to_row(data, rel_cols)}
    %SatTransOp{op: {:insert, op_insert}}
  end

  defp mk_trans_op(%UpdatedRecord{record: data, old_record: old_data}, rel_id, rel_cols) do
    op_update = %SatOpUpdate{
      relation_id: rel_id,
      row_data: map_to_row(data, rel_cols),
      old_row_data: map_to_row(old_data, rel_cols)
    }

    %SatTransOp{op: {:update, op_update}}
  end

  defp mk_trans_op(%DeletedRecord{old_record: data}, rel_id, rel_cols) do
    op_delete = %SatOpDelete{relation_id: rel_id, old_row_data: map_to_row(data, rel_cols)}
    %SatTransOp{op: {:delete, op_delete}}
  end

  @spec map_to_row(%{String.t() => binary()} | nil, [String.t()]) :: %SatOpRow{}
  def map_to_row(nil, _), do: nil

  def map_to_row(data, rel_cols) when is_list(rel_cols) and is_map(data) do
    bitmask = []
    values = []

    {num_columns, bitmask, values} =
      Enum.reduce(rel_cols, {0, bitmask, values}, fn column_name, {num, bitmask0, values0} ->
        # FIXME: This is ineficient, data should be stored in order, so that we
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
        %{oid: relation_id} = SchemaRegistry.fetch_table_info!(relation)

        columns =
          for %{name: column_name} <- SchemaRegistry.fetch_table_columns!(relation),
              do: column_name

        {:new, relation_id, columns, Map.put(known_relations, relation, {relation_id, columns})}

      {relation_id, columns} ->
        {:existing, relation_id, columns}
    end
  end

  @doc """
  Serialize internal relation representation to Satellite PB format
  """
  @spec serialize_relation(String.t(), String.t(), integer(), [SchemaRegistry.column()]) ::
          %SatRelation{}
  def serialize_relation(schema, name, oid, columns) do
    %SatRelation{
      schema_name: schema,
      table_type: :TABLE,
      table_name: name,
      relation_id: oid,
      columns: serialize_columns(columns, [])
    }
  end

  defp serialize_columns([%{name: name_str, type: type_atom} | rest], acc) do
    serialize_columns(
      rest,
      [%SatRelationColumn{name: name_str, type: :erlang.atom_to_binary(type_atom)} | acc]
    )
  end

  defp serialize_columns([], acc) do
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
            %SatOpInsert{row_data: row_data} ->
              data = row_to_map(relation.columns, row_data, false)
              %NewRecord{relation: {relation.schema, relation.table}, record: data}

            %SatOpUpdate{row_data: row_data, old_row_data: old_row_data} ->
              old_data = row_to_map(relation.columns, old_row_data, true)
              data = row_to_map(relation.columns, row_data, false)

              %UpdatedRecord{
                relation: {relation.schema, relation.table},
                record: data,
                old_record: old_data
              }

            %SatOpDelete{old_row_data: old_row_data} ->
              old_data = row_to_map(relation.columns, old_row_data, true)
              %DeletedRecord{relation: {relation.schema, relation.table}, old_record: old_data}
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
