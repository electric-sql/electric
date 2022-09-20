defmodule Electric.Satellite.WsServerTest do
  alias Electric.Replication.Vaxine.LogConsumer
  alias Electric.Replication.Vaxine.LogProducer
  alias Electric.Replication.Vaxine

  alias Electric.Test.SatelliteWsClient, as: MockClient

  alias Electric.Satellite.{
    SatAuthReq,
    SatAuthResp,
    SatPingReq,
    SatPingResp,
    SatInStartReplicationReq,
    SatInStartReplicationResp,
    SatInStopReplicationReq,
    SatInStopReplicationResp,
    SatRelation,
    SatRelationColumn,
    SatOpLog,
    SatTransOp,
    SatOpBegin,
    SatOpUpdate,
    SatOpDelete,
    SatOpInsert,
    SatOpCommit,
    SatErrorResp
  }

  alias Electric.Replication.Changes

  alias Electric.Replication.Changes.{
    NewRecord,
    Transaction
  }

  alias Electric.Postgres.SchemaRegistry

  require Logger

  use ExUnit.Case, async: false

  @default_wait 5_000

  @test_publication "fake_sqlite"
  @test_schema "fake_schema"
  @test_table "sqlite_server_test"
  @test_oid 100_004

  import Mock

  setup_all _ do
    SchemaRegistry.put_replicated_tables(@test_publication, [
      %{
        schema: @test_schema,
        name: @test_table,
        oid: @test_oid,
        replica_identity: :all_columns
      }
    ])

    SchemaRegistry.put_table_columns(
      {@test_schema, @test_table},
      [
        %{
          name: "id",
          type: :uuid,
          type_modifier: 0,
          part_of_identity?: nil
        },
        %{
          name: "content",
          type: :varchar,
          type_modifier: -1,
          part_of_identity?: nil
        }
      ]
    )

    on_exit(fn -> SchemaRegistry.clear_replicated_tables(@test_publication) end)
    :ok
  end

  setup_with_mocks([
    {LogProducer, [:passthrough],
     [
       start_link: fn a, b -> DownstreamProducerMock.start_link(a, b) end,
       start_replication: fn a, b -> DownstreamProducerMock.start_replication(a, b) end
     ]},
    # [:passthrough],
    {Vaxine, [],
     [
       transaction_to_vaxine: fn _tx, _pub, _origin -> :ok end
     ]}
  ]) do
    {:ok, %{}}
  end

  # make sure server is cleaning up connections
  setup do
    on_exit(fn -> clean_connections() end)
  end

  describe "decode/encode" do
    test "sanity check" do
      MockClient.connect_and_spawn()
      assert true == MockClient.is_alive()
      assert :ok = MockClient.disconnect()
    end

    test "Server will respond to auth request" do
      MockClient.connect_and_spawn()
      MockClient.send_data(%SatAuthReq{id: "id", token: "token"})

      assert_receive {MockClient, %SatAuthResp{id: server_id}}, @default_wait
      assert server_id !== ""

      assert :ok = MockClient.disconnect()
    end

    test "Server will handle bad requests" do
      MockClient.connect_and_spawn()
      MockClient.send_bin_data(<<"rubbish">>)

      assert_receive {MockClient, %SatErrorResp{}}, @default_wait

      assert :ok = MockClient.disconnect()
    end

    test "Server will handle bad requests after auth" do
      MockClient.connect_and_spawn([{:auth, true}])
      MockClient.send_bin_data(<<"rubbish">>)

      assert_receive {MockClient, %SatErrorResp{}}, @default_wait

      assert :ok = MockClient.disconnect()
    end

    test "Server will respond with error on attempt to skip auth" do
      MockClient.connect_and_spawn()
      MockClient.send_data(%SatPingReq{})

      assert_receive {_, %SatErrorResp{error_type: :AUTH_REQUIRED}}, @default_wait
      assert :ok = MockClient.disconnect()

      MockClient.connect_and_spawn()
      MockClient.send_data(%SatAuthReq{id: "id", token: "token"})
      assert_receive {_, %SatAuthResp{id: server_id}}, @default_wait
      assert server_id !== ""

      MockClient.send_data(%SatPingReq{})
      assert_receive {_, %SatPingResp{lsn: ""}}, @default_wait

      assert :ok = MockClient.disconnect()
    end
  end

  describe "Outgoing replication (Vaxine -> Satellite)" do
    test "common replication" do
      MockClient.connect_and_spawn([{:auth, true}])
      MockClient.send_data(%SatInStartReplicationReq{lsn: "eof"})

      assert_receive {_, %SatInStartReplicationResp{}}, @default_wait

      [{client_name, _client_pid}] = active_clients()
      mocked_producer = LogProducer.get_name(client_name)

      :ok =
        DownstreamProducerMock.produce(
          mocked_producer,
          simple_transes(10)
        )

      Enum.map(0..10, fn n ->
        %SatOpLog{ops: ops} = receive_trans()
        [%SatTransOp{op: begin} | _] = ops
        {:begin, %SatOpBegin{lsn: lsn}} = begin
        assert :erlang.term_to_binary(n) == lsn
      end)

      assert :ok = MockClient.disconnect()
    end

    test "Start/stop replication" do
      limit = 100

      MockClient.connect_and_spawn([{:auth, true}])
      MockClient.send_data(%SatInStartReplicationReq{lsn: "eof"})

      assert_receive {_, %SatInStartReplicationResp{}}, @default_wait

      [{client_name, _client_pid}] = active_clients()
      mocked_producer = LogProducer.get_name(client_name)

      :ok =
        DownstreamProducerMock.produce(
          mocked_producer,
          simple_transes(limit)
        )

      MockClient.send_data(%SatInStopReplicationReq{})
      last_received_lsn = consume_till_stop(nil)
      assert last_received_lsn !== Kernel.inspect(limit)

      MockClient.send_data(%SatInStartReplicationReq{lsn: last_received_lsn})
      num_lsn = :erlang.binary_to_term(last_received_lsn)

      :ok =
        DownstreamProducerMock.produce(
          mocked_producer,
          simple_transes(limit, num_lsn)
        )

      Enum.map(num_lsn..limit, fn n ->
        %SatOpLog{ops: ops} = receive_trans()
        [%SatTransOp{op: begin} | _] = ops
        {:begin, %SatOpBegin{lsn: lsn}} = begin
        assert :erlang.term_to_binary(n) == lsn
      end)

      assert :ok = MockClient.disconnect()
    end
  end

  describe "Incoming replication (Satellite -> Vaxine)" do
    test "common replication" do
      self = self()

      with_mock Vaxine,
        transaction_to_vaxine: fn tx, pub, origin -> Process.send(self, {tx, pub, origin}, []) end do
        MockClient.connect_and_spawn([{:auth, true}])
        MockClient.send_data(%SatInStartReplicationReq{lsn: "eof"})
        assert_receive {_, %SatInStartReplicationResp{}}, @default_wait

        assert_receive {_, %SatInStartReplicationReq{lsn: ""}}
        MockClient.send_data(%SatInStartReplicationResp{})

        columns = [
          %SatRelationColumn{name: "satellite-column-1", type: "type1"},
          %SatRelationColumn{name: "satellite-column-2", type: "type2"}
        ]

        relation = %SatRelation{
          schema_name: @test_schema,
          table_type: :TABLE,
          table_name: @test_table,
          relation_id: @test_oid,
          columns: columns
        }

        MockClient.send_data(relation)

        dt = DateTime.truncate(DateTime.utc_now(), :millisecond)
        ct = DateTime.to_unix(dt, :millisecond)
        lsn = "some_long_internal_lsn"

        op_log1 =
          build_op_log([
            %SatOpBegin{commit_timestamp: ct, lsn: lsn},
            %SatOpInsert{relation_id: @test_oid, row_data: [<<"a">>, <<"b">>]}
          ])

        op_log2 =
          build_op_log([
            %SatOpInsert{relation_id: @test_oid, row_data: [<<"c">>, <<"d">>]},
            %SatOpCommit{}
          ])

        MockClient.send_data(op_log1)
        MockClient.send_data(op_log2)

        {tx, _pub, _origin} =
          receive do
            {%Transaction{} = tx, pub, origin} ->
              {tx, pub, origin}
          after
            @default_wait ->
              flunk("timeout")
          end

        assert tx.lsn == lsn
        assert tx.commit_timestamp == dt

        assert tx.changes == [
                 %NewRecord{
                   relation: {@test_schema, @test_table},
                   record: %{"satellite-column-1" => "a", "satellite-column-2" => "b"}
                 },
                 %NewRecord{
                   relation: {@test_schema, @test_table},
                   record: %{"satellite-column-1" => "c", "satellite-column-2" => "d"}
                 }
               ]

        assert tx.origin !== ""
        assert_receive {_, %SatPingResp{lsn: lsn}}
        # assert_recieve {_, %SatPingResp{lsn: lsn}} @default_wait
      end
    end

    test "stop subscription when consumer is not available, and restart when it's back" do
      self = self()

      with_mock Vaxine,
        transaction_to_vaxine: fn tx, pub, origin -> Process.send(self, {tx, pub, origin}, []) end do
        MockClient.connect_and_spawn([{:auth, true}])
        MockClient.send_data(%SatInStartReplicationReq{lsn: "eof"})
        assert_receive {_, %SatInStartReplicationResp{}}, @default_wait

        assert_receive {_, %SatInStartReplicationReq{lsn: ""}}
        MockClient.send_data(%SatInStartReplicationResp{})

        [{client_name, _client_pid}] = active_clients()
        {:via, :gproc, mocked_consumer} = LogConsumer.get_name(client_name)
        pid = :gproc.whereis_name(mocked_consumer)
        Process.monitor(pid)
        Process.exit(pid, :terminate)
        assert_receive {:DOWN, _, :process, ^pid, _}

        assert_receive {_, %SatInStopReplicationReq{}}
        assert_receive {_, %SatInStartReplicationReq{}}
      end
    end
  end

  # -------------------------------------------------------------------------------

  def clean_connections() do
    MockClient.disconnect()

    case active_clients() do
      [{_client_name, client_pid}] ->
        ref = Process.monitor(client_pid)

        receive do
          {:DOWN, ^ref, :process, ^client_pid, _} -> :ok
        after
          5000 ->
            flunk("tcp client process didn't termivate")
        end

      [] ->
        :ok
    end
  end

  defp consume_till_stop(lsn) do
    receive do
      {_, %SatOpLog{} = op_log} ->
        lsn = get_lsn(op_log)
        # Logger.warn("consumed: #{inspect(lsn)}")
        consume_till_stop(lsn)

      {_, %SatInStopReplicationResp{}} ->
        lsn
    after
      @default_wait ->
        flunk("timeout")
    end
  end

  defp receive_trans() do
    receive do
      {_, %SatOpLog{} = op_log} -> op_log
    after
      @default_wait ->
        flunk("timeout")
    end
  end

  defp get_lsn(%SatOpLog{ops: ops}) do
    [%SatTransOp{op: begin} | _] = ops
    {:begin, %SatOpBegin{lsn: lsn}} = begin
    lsn
  end

  defp active_clients() do
    {:ok, clients} = Electric.Satellite.ClientManager.get_clients()

    Enum.reduce(clients, [], fn {client_name, client_pid}, acc ->
      case Process.alive?(client_pid) do
        true -> [{client_name, client_pid} | acc]
        false -> acc
      end
    end)
  end

  defp build_events(changes, lsn) do
    [
      {%Changes.Transaction{changes: List.wrap(changes), commit_timestamp: DateTime.utc_now()},
       lsn}
    ]
  end

  defp simple_transes(n, lim \\ 0) do
    simple_trans(n, lim, [])
  end

  defp simple_trans(n, lim, acc) when n >= lim do
    [trans] =
      %Changes.NewRecord{
        record: %{"content" => "a", "id" => "fakeid"},
        relation: {@test_schema, @test_table}
      }
      |> build_events(n)

    simple_trans(n - 1, lim, [trans | acc])
  end

  defp simple_trans(_n, _lim, acc) do
    acc
  end

  def build_changes(%SatOpBegin{} = op), do: %SatTransOp{op: {:begin, op}}
  def build_changes(%SatOpInsert{} = op), do: %SatTransOp{op: {:insert, op}}
  def build_changes(%SatOpUpdate{} = op), do: %SatTransOp{op: {:update, op}}
  def build_changes(%SatOpDelete{} = op), do: %SatTransOp{op: {:delete, op}}
  def build_changes(%SatOpCommit{} = op), do: %SatTransOp{op: {:commit, op}}

  defp build_op_log(changes) do
    ops = Enum.map(changes, fn change -> build_changes(change) end)
    %SatOpLog{ops: ops}
  end
end
