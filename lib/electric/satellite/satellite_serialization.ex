defmodule Electric.Satellite.Replication do
  alias Electric.Satellite.{
    SatOpLog,
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
  Serialize from internal format to Satellite format
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

        {rel_id, new_relations, known_relations1} =
          case fetch_relation_id(relation, known_relations1) do
            {:new, relation_id, known_relations2} ->
              {relation_id, [relation | new_relations], known_relations2}

            {:existing, relation_id} ->
              {relation_id, new_relations, known_relations1}
          end

        op = mk_trans_op(record, rel_id)

        {[op | ops], new_relations, known_relations1}
      end)

    {%SatOpLog{ops: Enum.reverse([tx_end | ops])}, new_relations, known_relations}
  end

  defp mk_trans_op(%NewRecord{}, rel_id) do
    op_insert = %SatOpInsert{relation_id: rel_id}
    %SatTransOp{op: {:insert, op_insert}}
  end

  defp mk_trans_op(%UpdatedRecord{}, rel_id) do
    op_update = %SatOpUpdate{relation_id: rel_id}
    %SatTransOp{op: {:update, op_update}}
  end

  defp mk_trans_op(%DeletedRecord{}, rel_id) do
    op_delete = %SatOpDelete{relation_id: rel_id}
    %SatTransOp{op: {:delete, op_delete}}
  end

  def fetch_relation_id(relation, known_relations) do
    case Map.get(known_relations, relation, nil) do
      nil ->
        %{oid: relation_id} = SchemaRegistry.fetch_table_info!(relation)
        {:new, relation_id, Map.put(known_relations, relation, relation_id)}

      relation_id ->
        {:existing, relation_id}
    end
  end

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
  Deserialize from Satellite format to internal format
  """
  @spec deserialize_trans(String.t(), %SatOpLog{}, %Transaction{} | nil, %{
          PB.relation_id() => %{
            :schema => String.t(),
            :table => String.t(),
            :columns => [String.t()]
          }
        }) ::
          {
            incomplete :: %Transaction{} | nil,
            # Complete transactions are send in reverse order
            complete :: [%Transaction{}]
          }
  def deserialize_trans(origin, %SatOpLog{} = op_log, nil, relations) do
    deserialize_op_log(origin, op_log, {nil, []}, relations)
  end

  def deserialize_trans(origin, %SatOpLog{} = op_log, %Transaction{} = trans, relations) do
    deserialize_op_log(origin, op_log, {trans, []}, relations)
  end

  defp deserialize_op_log(origin, %SatOpLog{} = msg, incomplete, relations) do
    Enum.reduce(msg.ops, incomplete, fn
      %SatTransOp{op: {:begin, %SatOpBegin{} = op}}, {nil, complete} ->
        {:ok, dt} = DateTime.from_unix(op.commit_timestamp, :millisecond)

        trans = %Transaction{
          origin: origin,
          changes: [],
          publication: "",
          commit_timestamp: dt,
          lsn: op.lsn,
          # FIXME: Acknowledge to satellite
          ack_fn: fn -> :ok end
        }

        {trans, complete}

      %SatTransOp{op: {:commit, %SatOpCommit{} = _op}}, {trans, complete} ->
        trans = %Transaction{trans | changes: Enum.reverse(trans.changes)}
        {nil, [trans | complete]}

      %SatTransOp{op: {_, op}}, {trans, complete} ->
        transop =
          case op do
            %SatOpInsert{relation_id: relation_id, row_data: row_data} ->
              relation = fetch_relation(relations, relation_id)
              data = data_tuple_to_map(relation.columns, row_data)

              %NewRecord{relation: {relation.schema, relation.table}, record: data}

            %SatOpUpdate{relation_id: relation_id, row_data: row_data, old_row_data: old_row_data} ->
              relation = fetch_relation(relations, relation_id)
              old_data = data_tuple_to_map(relation.columns, old_row_data)
              data = data_tuple_to_map(relation.columns, row_data)

              %UpdatedRecord{
                relation: {relation.schema, relation.table},
                record: data,
                old_record: old_data
              }

            %SatOpDelete{relation_id: relation_id, old_row_data: old_row_data} ->
              relation = fetch_relation(relations, relation_id)
              old_data = data_tuple_to_map(relation.columns, old_row_data)
              %DeletedRecord{relation: {relation.schema, relation.table}, old_record: old_data}
          end

        {%Transaction{trans | changes: [transop | trans.changes]}, complete}
    end)
  end

  defp fetch_relation(relations, relation_id) do
    Map.get(relations, relation_id)
  end

  defp data_tuple_to_map(columns, list_data) do
    columns
    |> Enum.zip(list_data)
    |> Map.new(fn {column_name, data} -> {column_name, data} end)
  end
end
