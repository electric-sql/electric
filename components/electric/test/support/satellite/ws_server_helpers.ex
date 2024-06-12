defmodule ElectricTest.Satellite.WsServerHelpers do
  use Electric.Satellite.Protobuf

  alias Electric.Replication.Changes
  alias __MODULE__

  import ExUnit.Assertions

  @default_wait 5_000
  @test_schema "public"
  @test_table "sqlite_server_test"

  defmacro __using__(_opts \\ []) do
    test_schema = @test_schema
    test_table = @test_table

    quote do
      alias Electric.Postgres.CachedWal.Producer
      alias Satellite.ProtocolHelpers
      alias Satellite.TestWsClient, as: MockClient

      import ElectricTest.SetupHelpers
      import ElectricTest.SatelliteHelpers
      import ElectricTest.Satellite.WsServerHelpers
      import Mock

      @test_schema unquote(test_schema)
      @test_table unquote(test_table)
      @test_oid 100_004
      @current_wal_pos 1
      @user_id "a5408365-7bf4-48b1-afe2-cb8171631d7c"

      setup_with_mocks([
        {Electric.Postgres.Repo, [:passthrough],
         checkout: fn fun -> fun.() end,
         transaction: fn fun -> fun.() end,
         checked_out?: fn -> true end,
         query: fn _, _ -> {:ok, %Postgrex.Result{columns: nil, rows: []}} end,
         query!: fn _, _ -> %Postgrex.Result{columns: nil, rows: []} end}
      ]) do
        %{}
      end

      setup ctx do
        test_pid = self()

        ctx
        |> Map.update(
          :subscription_data_fun,
          &WsServerHelpers.mock_data_function/2,
          fn
            {module, name, opts} -> &apply(module, name, [&1, &2, opts])
            {name, opts} -> &apply(WsServerHelpers, name, [&1, &2, opts])
          end
        )
        |> Map.put_new(:move_in_data_fun, {WsServerHelpers, :mock_move_in_data_fn, []})
        |> Map.update!(
          :move_in_data_fun,
          fn {module, name, opts} ->
            &apply(module, name, [&1, &2, &3, &4, [{:test_pid, test_pid} | opts]])
          end
        )
        |> Map.put_new(:allowed_unacked_txs, 30)
      end

      setup_with_mocks([
        {Electric.Replication.SatelliteConnector, [:passthrough],
         [
           start_link: fn %{name: name, producer: producer} ->
             Supervisor.start_link(
               [
                 {Electric.DummyConsumer, subscribe_to: [{producer, []}], name: :dummy_consumer},
                 {DownstreamProducerMock, Producer.name(name)}
               ],
               strategy: :one_for_one
             )
           end
         ]},
        {
          Electric.Postgres.CachedWal.Api,
          [:passthrough],
          get_current_position: fn _ -> @current_wal_pos end,
          lsn_in_cached_window?: fn _origin, pos when is_integer(pos) ->
            pos > @current_wal_pos
          end,
          stream_transactions: fn _, _, _ -> [] end
        }
      ]) do
        %{}
      end

      # make sure server is cleaning up connections
      setup _cxt do
        on_exit(fn -> clean_connections() end)

        client_id = "device-id-#{Enum.random(100_000..999_999)}"
        token = Electric.Satellite.Auth.Secure.create_token(@user_id)

        {:ok, user_id: @user_id, client_id: client_id, token: token}
      end

      setup ctx do
        start_schema_cache(ctx[:with_migrations] || [])
      end
    end
  end

  def mock_data_function(
        {id, requests, _context},
        [reply_to: {ref, pid}, connection: _, telemetry_span: _, relation_loader: _],
        opts \\ []
      ) do
    insertion_point = Keyword.get(opts, :insertion_point, 0)
    data_delay_ms = Keyword.get(opts, :data_delay_ms, 0)
    send(pid, {:data_insertion_point, ref, insertion_point})

    Process.send_after(
      pid,
      {:subscription_data, id, insertion_point, {Graph.new(), %{}, Enum.map(requests, & &1.id)}},
      data_delay_ms
    )
  end

  def mock_move_in_data_fn(
        move_in_ref,
        {subquery_map, affected_txs},
        _context,
        [reply_to: {ref, pid}, connection: _, relation_loader: _],
        opts \\ []
      ) do
    test_pid = Keyword.fetch!(opts, :test_pid)
    test_ref = make_ref()

    send(test_pid, {:mock_move_in, {self(), test_ref}, move_in_ref, subquery_map})

    {insertion_point, graph_updates, changes} =
      receive do
        {:mock_move_in_data, ^test_ref, value} ->
          value
      end

    send(pid, {:data_insertion_point, ref, insertion_point})

    request_ids = MapSet.new(Map.keys(subquery_map), & &1.request_id)

    receive do
      {:mock_move_in_trigger, ^test_ref} ->
        send(
          pid,
          {:move_in_query_data, move_in_ref, insertion_point,
           {request_ids, graph_updates, changes}, affected_txs}
        )
    end
  end

  def clean_connections() do
    :ok = drain_pids(active_clients())
    :ok = drain_active_resources(connectors())
  end

  def connectors() do
    for {mod, pid} <- Electric.Replication.Connectors.status(:raw),
        mod !== Electric.Replication.PostgresConnectorSup,
        do: {mod, pid}
  end

  def drain_active_resources([]) do
    :ok
  end

  def drain_active_resources([{Electric.Replication.SatelliteConnector, _} | _] = list) do
    drain_pids(list)
  end

  defp drain_pids([]) do
    :ok
  end

  defp drain_pids([{_client_name, client_pid} | list]) do
    ref = Process.monitor(client_pid)

    receive do
      {:DOWN, ^ref, :process, ^client_pid, _} ->
        drain_pids(list)
    after
      1000 ->
        flunk("tcp client process didn't termivate")
    end
  end

  def consume_till_stop(lsn) do
    receive do
      {_, %SatOpLog{} = op_log} ->
        lsn = get_lsn(op_log)
        # Logger.warning("consumed: #{inspect(lsn)}")
        consume_till_stop(lsn)

      {_, %SatRpcResponse{method: "stopReplication"}} ->
        lsn
    after
      @default_wait ->
        flunk("Timeout while waiting for SatInStopReplicationResp")
    end
  end

  def receive_trans() do
    receive do
      {_, %SatOpLog{} = op_log} -> op_log
    after
      @default_wait ->
        flunk("timeout")
    end
  end

  def get_lsn(%SatOpLog{ops: ops}) do
    assert [%SatTransOp{op: begin} | _] = ops
    assert {:begin, %SatOpBegin{lsn: lsn}} = begin
    lsn
  end

  def active_clients() do
    Electric.Satellite.ClientManager.get_clients()
    |> Enum.flat_map(fn {client_name, client_pid} ->
      if Process.alive?(client_pid) do
        [{client_name, client_pid}]
      else
        []
      end
    end)
  end

  def build_events(changes, lsn, origin \\ nil) do
    [
      {%Changes.Transaction{
         changes: List.wrap(changes),
         commit_timestamp: DateTime.utc_now(),
         origin: origin,
         # The LSN here is faked and a number, so we're using the same monotonically growing value as xid to emulate PG
         xid: lsn
       }, lsn}
    ]
  end

  def simple_transes(user_id, n, lim \\ 0) do
    simple_trans(user_id, n, lim, [])
  end

  defp simple_trans(user_id, n, lim, acc) when n >= lim do
    [trans] =
      %Changes.NewRecord{
        record: %{"content" => "a", "id" => "fakeid", "electric_user_id" => user_id},
        relation: {@test_schema, @test_table}
      }
      |> build_events(n)

    simple_trans(user_id, n - 1, lim, [trans | acc])
  end

  defp simple_trans(_user_id, _n, _lim, acc) do
    acc
  end

  def build_changes(%SatOpBegin{} = op), do: %SatTransOp{op: {:begin, op}}
  def build_changes(%SatOpInsert{} = op), do: %SatTransOp{op: {:insert, op}}
  def build_changes(%SatOpUpdate{} = op), do: %SatTransOp{op: {:update, op}}
  def build_changes(%SatOpDelete{} = op), do: %SatTransOp{op: {:delete, op}}
  def build_changes(%SatOpCommit{} = op), do: %SatTransOp{op: {:commit, op}}

  def build_op_log(changes) do
    ops = Enum.map(changes, fn change -> build_changes(change) end)
    %SatOpLog{ops: ops}
  end
end
