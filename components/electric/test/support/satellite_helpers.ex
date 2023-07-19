defmodule ElectricTest.SatelliteHelpers do
  use Electric.Satellite.Protobuf

  import ExUnit.Assertions

  alias Electric.Test.SatelliteWsClient, as: MockClient

  # Send a ping to WsServer. Useful to make sure it is done with initial sync.
  def ping_server(conn) do
    MockClient.send_data(conn, %SatPingReq{})
    assert_receive {^conn, %SatPingResp{lsn: ""}}
  end

  def assert_receive_migration(conn, version, table_name) do
    assert_receive {^conn, %SatRelation{table_name: ^table_name}}

    assert_receive {^conn,
                    %SatOpLog{
                      ops: [
                        %SatTransOp{
                          op: {:begin, %SatOpBegin{is_migration: true, lsn: lsn_str}}
                        },
                        %SatTransOp{
                          op: {:migrate, %{version: ^version, table: %{name: ^table_name}}}
                        },
                        %SatTransOp{op: {:commit, _}}
                      ]
                    }}

    assert {lsn, ""} = Integer.parse(lsn_str)
    assert lsn > 0
  end
end
