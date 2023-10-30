defmodule ElectricTest.SatelliteHelpers do
  alias Electric.Replication.Changes.Transaction
  alias Electric.Satellite.Serialization
  use Electric.Satellite.Protobuf

  import ExUnit.Assertions

  alias Satellite.TestWsClient, as: MockClient

  @doc """
  Starts the replication and then asserts that the server sends all messages
  that it should to `Satellite.TestWsClient` after replication request has been sent.

  Assumes that the database has been migrated before the replication started, and that
  there is only one migration that includes all tables. If you need more granular control over
  this response -- don't use this function.
  """
  def start_replication_and_assert_response(conn, table_count) do
    assert {:ok, _} =
             MockClient.make_rpc_call(conn, "startReplication", %SatInStartReplicationReq{})

    assert_receive {^conn, %SatRpcRequest{method: "startReplication"}}

    unless table_count == 0 do
      cached_relations =
        for _ <- 1..table_count, into: %{} do
          assert_receive {^conn, %SatRelation{} = rel}

          # TODO: This makes a generally incorrect assumption that PK columns come in order in the relation
          #       It works in most cases, but we need actual PK order information on the protocol
          #       for multi-col PKs to work
          {columns, _} =
            Enum.map_reduce(rel.columns, 0, fn col, pk_pos ->
              info = %{
                name: col.name,
                type: String.to_atom(col.type),
                nullable?: col.is_nullable,
                pk_position: if(col.primaryKey, do: pk_pos, else: nil)
              }

              {info, if(col.primaryKey, do: pk_pos + 1, else: pk_pos)}
            end)

          {rel.relation_id,
           %{
             schema: rel.schema_name,
             table: rel.table_name,
             columns: columns
           }}
        end

      assert_receive {^conn,
                      %SatOpLog{
                        ops: ops
                      }},
                     300

      assert length(ops) == 2 + table_count
      assert [_begin | ops] = ops
      {migrates, [_end]} = Enum.split(ops, table_count)
      Enum.each(migrates, fn op -> assert %SatTransOp{op: {:migrate, _}} = op end)

      # We shouldn't receive anything else without subscriptions
      refute_receive {^conn, %SatOpLog{}}

      cached_relations
    end
  end

  def receive_txn_changes(conn, cached_relations, timeout \\ 1000) do
    assert_receive {^conn, %SatOpLog{} = oplog}, timeout

    assert {nil, [%Transaction{} = txn]} =
             Serialization.deserialize_trans("postgres_1", oplog, nil, cached_relations, & &1)

    Enum.sort_by(txn.changes, &{&1.__struct__, &1.relation})
  end

  def receive_additional_changes(conn, cached_relations, timeout \\ 1000) do
    assert_receive {^conn, %SatOpLog{} = oplog}, timeout

    assert {nil, [{:additional_data, ref, changes}]} =
             Serialization.deserialize_trans("postgres_1", oplog, nil, cached_relations, & &1)

    {ref, Enum.sort_by(changes, &{&1.__struct__, &1.relation})}
  end

  def assert_receive_migration(conn, version, table_name) do
    assert_receive {^conn, %SatRelation{table_name: ^table_name}}

    assert_receive {^conn,
                    %SatOpLog{
                      ops: [
                        %{op: {:begin, %SatOpBegin{is_migration: true, lsn: lsn_str}}},
                        %{op: {:migrate, %{version: ^version, table: %{name: ^table_name}}}},
                        %{op: {:commit, _}}
                      ]
                    }}

    assert {lsn, ""} = Integer.parse(lsn_str)
    assert lsn > 0
  end

  def with_connect(opts, fun), do: MockClient.with_connect(opts, fun)

  def migrate(conn, version, sql, opts \\ []) do
    # we need to explicitly capture ddl statements affecting electrified tables
    # unless we're connecting via the proxy
    electrify =
      if table = opts[:electrify], do: "CALL electric.electrify('#{table}')"

    capture =
      if opts[:capture], do: "CALL electric.capture_ddl($$#{sql}$$)"

    results =
      :epgsql.squery(
        conn,
        """
        BEGIN;
          CALL electric.migration_version('#{version}');
          #{sql};
          #{electrify};
          #{capture};
        COMMIT;
        """
      )

    Enum.each(results, fn result ->
      assert {:ok, _, _} = result
    end)

    :ok
  end

  @doc """
  Wait for and receives subscription data response as sent back to the test process by `Satellite.TestWsClient`.

  Waits for the `SatSubsDataBegin` message, then for each shape data, then for the end message,
  and verifies their order. Returns a tuple, with first element being all the mentioned request IDs, and the second being all the data.
  """
  @spec receive_subscription_data(term(), String.t(), [
          {:timeout, non_neg_integer()} | {:expecting_lsn, String.t()}
        ]) :: {[String.t()], [%SatOpInsert{}]}
  def receive_subscription_data(conn, subscription_id, opts \\ []) do
    # TODO: Addition of shapes complicated initial data sending for multiple requests due to records
    #       fulfilling multiple requests so we're "cheating" here while the client doesn't care by
    #       sending all but one "request data" messages empty, and stuffing entire response into the first one.
    #       See paired comment in `Electric.Satellite.Protocol.handle_subscription_data/3`
    first_message_timeout = Keyword.get(opts, :timeout, 1000)

    receive do
      {^conn, %SatSubsDataBegin{subscription_id: ^subscription_id, lsn: received_lsn}} ->
        case Keyword.fetch(opts, :expecting_lsn) do
          {:ok, expected_lsn} -> assert expected_lsn == received_lsn
          _ -> nil
        end

        receive_rest_of_subscription_data(conn, [])
        |> assert_subscription_data_format({[], []})
    after
      first_message_timeout ->
        {:messages, messages} = :erlang.process_info(self(), :messages)

        flunk(
          "Timed out waiting for #{inspect(%SatSubsDataBegin{subscription_id: subscription_id})} after #{first_message_timeout} ms.\n\nCurrent messages: #{inspect(messages, pretty: true)}"
        )
    end
  end

  defp receive_rest_of_subscription_data(conn, acc) do
    receive do
      {^conn, %SatSubsDataEnd{}} ->
        Enum.reverse(acc)

      {_, %type{} = msg}
      when type in [SatOpLog, SatShapeDataBegin, SatShapeDataEnd] ->
        receive_rest_of_subscription_data(conn, [msg | acc])
    after
      100 ->
        flunk(
          "Timeout while waiting for message sequence responding to a subscription, received:\n#{inspect(acc, pretty: true)}"
        )
    end
  end

  defp assert_subscription_data_format([], acc), do: acc

  defp assert_subscription_data_format(messages, {ids, data}) do
    assert [%SatShapeDataBegin{request_id: id} | messages] = messages
    {oplogs, messages} = Enum.split_while(messages, &match?(%SatOpLog{}, &1))

    oplogs =
      oplogs
      |> Enum.flat_map(& &1.ops)
      |> Enum.map(fn op ->
        assert %SatTransOp{op: {:insert, %SatOpInsert{} = insert}} = op,
               "Expected only SatOpInsert operations to be in the OpLog messages"

        insert
      end)

    assert [%SatShapeDataEnd{} | messages] = messages

    assert_subscription_data_format(messages, {[id | ids], data ++ oplogs})
  end
end
