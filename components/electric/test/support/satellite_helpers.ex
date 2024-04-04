defmodule ElectricTest.SatelliteHelpers do
  alias Electric.Replication.Changes.Transaction
  alias Electric.Satellite.Serialization
  use Electric.Satellite.Protobuf

  import ExUnit.Assertions

  alias Satellite.TestWsClient, as: MockClient

  @type col_info :: %{
          name: String.t(),
          type: atom(),
          nullable?: boolean(),
          pk_position: pos_integer() | nil
        }
  @type cached_rels :: %{
          optional(non_neg_integer()) => %{
            columns: [col_info()],
            schema: binary(),
            table: binary()
          }
        }

  @doc """
  Starts the replication and then asserts that the server sends all messages
  that it should to `Satellite.TestWsClient` after replication request has been sent.

  Assumes that the database has been migrated before the replication started, and that
  there is only one migration that includes all tables. If you need more granular control over
  this response -- don't use this function.
  """
  @spec start_replication_and_assert_response(term(), non_neg_integer()) :: cached_rels()
  @spec start_replication_and_assert_response(term(), non_neg_integer(), non_neg_integer()) ::
          cached_rels()
  def start_replication_and_assert_response(conn, table_count, extra_table_count \\ 0) do
    assert {:ok, _} =
             MockClient.make_rpc_call(conn, "startReplication", %SatInStartReplicationReq{})

    assert_receive {^conn, %SatRpcRequest{method: "startReplication"}}, 500

    unless table_count == 0 do
      cached_relations =
        for _ <- 1..table_count, into: %{} do
          assert_receive {^conn, %SatRelation{} = rel}, 500

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

      assert_receive {^conn, %SatOpLog{ops: ops}}, 300

      assert length(ops) == 2 + table_count
      assert [_begin | ops] = ops
      {migrates, [_end]} = Enum.split(ops, table_count)
      Enum.each(migrates, fn op -> assert %SatTransOp{op: {:migrate, _}} = op end)

      if extra_table_count > 0 do
        for _ <- 1..extra_table_count do
          assert_receive {^conn, %SatRelation{}}, 500
          assert_receive {^conn, %SatOpLog{ops: ops}}, 300
          assert length(ops) == 3
        end
      end

      # We shouldn't receive anything else without subscriptions
      refute_receive {^conn, %SatOpLog{}}

      cached_relations
    end
  end

  def receive_txn(conn, cached_relations, timeout \\ 1000) do
    assert_receive {^conn, %SatOpLog{} = oplog}, timeout

    assert {nil, [%Transaction{} = txn]} =
             Serialization.deserialize_trans("postgres_1", oplog, nil, cached_relations)

    %{txn | changes: Enum.sort_by(txn.changes, &{&1.__struct__, &1.relation})}
  end

  def receive_txn_changes(conn, cached_relations, timeout \\ 1000),
    do: Map.fetch!(receive_txn(conn, cached_relations, timeout), :changes)

  def receive_additional_changes(conn, cached_relations, timeout \\ 1000) do
    assert_receive {^conn, %SatOpLog{} = oplog}, timeout

    assert {nil, [{:additional_data, ref, changes}]} =
             Serialization.deserialize_trans("postgres_1", oplog, nil, cached_relations)

    assert is_integer(ref)

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
          {:timeout, non_neg_integer()} | {:expecting_lsn, String.t()} | {:returning_lsn, true}
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

        result =
          receive_rest_of_subscription_data(conn, [])
          |> assert_subscription_data_format({[], []})

        if Keyword.has_key?(opts, :returning_lsn), do: {received_lsn, result}, else: result
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

  defmodule GrantAllPermissions do
    @moduledoc """
    A SchemaLoader implementation that overrides the permissions loading function
    with a "grant all on all tables" implementation.
    """

    alias Electric.Postgres.Extension.SchemaCache
    alias Electric.Satellite.SatPerms
    alias ElectricTest.PermissionsHelpers.Proto, as: ProtoHelpers

    defstruct [:user_id, :version]

    # Partial implementation of Electric.Postgres.Extension.SchemaLoader
    def connect(opts, _conn_config) do
      {:ok, Map.new(opts)}
    end

    def user_permissions(state, user_id) do
      with {:ok, schema_version} <- SchemaCache.load(state.origin),
           {:ok, perms} <- state.perms_func.(user_id, schema_version) do
        {:ok, state, perms}
      end
    end

    def user_permissions(_state, user_id, version) do
      {:ok, %__MODULE__{user_id: user_id, version: version}}
    end

    def load(state) do
      SchemaCache.load(state.origin)
    end

    def load(state, version) do
      SchemaCache.load(state.origin, version)
    end

    def tx_version(state, row) do
      SchemaCache.tx_version(state.origin, row)
    end

    def all_permissions(user_id, schema_version) do
      role =
        case user_id do
          user_id when is_binary(user_id) ->
            ProtoHelpers.authenticated()

          nil ->
            ProtoHelpers.anyone()
        end

      grants =
        schema_version.tables
        |> Enum.filter(fn {{s, _}, _} -> s == "public" end)
        |> Enum.flat_map(fn {relation, _table} ->
          for p <- [:DELETE, :INSERT, :SELECT, :UPDATE] do
            %SatPerms.Grant{
              table: ProtoHelpers.table(relation),
              privilege: p,
              role: role
            }
          end
        end)

      rules = %SatPerms.Rules{grants: grants, assigns: []}

      {:ok, %SatPerms{user_id: user_id, rules: rules, roles: []}}
    end
  end

  def grant_all_permissions_loader(origin) do
    {GrantAllPermissions, [origin: origin, perms_func: &GrantAllPermissions.all_permissions/2]}
  end

  def grant_specific_permissions_loader(origin, perms_func) when is_function(perms_func, 2) do
    {GrantAllPermissions, [origin: origin, perms_func: perms_func]}
  end

  def drain_pids do
    active_clients()
    |> drain_active_pids()
  end

  defp active_clients() do
    Electric.Satellite.ClientManager.get_clients()
    |> Enum.flat_map(fn {client_name, client_pid} ->
      if Process.alive?(client_pid) do
        [{client_name, client_pid}]
      else
        []
      end
    end)
  end

  defp drain_active_pids([]) do
    :ok
  end

  defp drain_active_pids([{_client_name, client_pid} | list]) do
    ref = Process.monitor(client_pid)

    receive do
      {:DOWN, ^ref, :process, ^client_pid, _} ->
        drain_active_pids(list)
    after
      1000 ->
        flunk("tcp client process didn't termivate")
    end
  end
end
