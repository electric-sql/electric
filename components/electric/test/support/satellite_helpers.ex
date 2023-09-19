defmodule ElectricTest.SatelliteHelpers do
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
      for _ <- 1..table_count, do: assert_receive({^conn, %SatRelation{}})

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
    end
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

  def migrate(conn, version, table \\ nil, sql) do
    results =
      :epgsql.squery(conn, """
      BEGIN;
      SELECT electric.migration_version('#{version}');
      #{sql};
      #{if table, do: "CALL electric.electrify('#{table}');"}
      COMMIT;
      """)

    Enum.each(results, fn result ->
      assert {:ok, _, _} = result
    end)

    :ok
  end
end
