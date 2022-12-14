defmodule Electric.Postgres.PBTest do
  use Electric.Satellite.Protobuf
  use ExUnit.Case, async: true

  describe "Decode and encode work correctly" do
    test "message for SatAuthReq is encoded and decoded" do
      original_msg = %SatAuthReq{token: "token"}
      {:ok, type, iodata} = PB.encode(original_msg)
      {:ok, decoded_msg} = PB.decode(type, :erlang.iolist_to_binary(iodata))
      assert original_msg == decoded_msg
    end

    test "message for SatPingReq is encoded and decoded" do
      original_msg = %SatPingReq{}
      {:ok, type, iodata} = PB.encode(original_msg)
      {:ok, decoded_msg} = PB.decode(type, :erlang.iolist_to_binary(iodata))
      assert original_msg == decoded_msg
    end

    test "message for transaction" do
      begin = %SatOpBegin{
        commit_timestamp: :os.system_time(:millisecond),
        trans_id: "",
        lsn: "234234"
      }

      data1 = %SatOpInsert{
        relation_id: 10,
        row_data: %SatOpRow{
          nulls_bitmask: <<0::1, 0::1, 0::1, 0::5>>,
          values: [<<"1">>, <<"2">>, <<"10">>]
        }
      }

      data2 = %SatOpUpdate{
        relation_id: 10,
        row_data: %SatOpRow{
          nulls_bitmask: <<0::1, 0::1, 0::1, 0::5>>,
          values: [<<"1">>, <<"2">>, <<"10">>]
        },
        old_row_data: %SatOpRow{
          nulls_bitmask: <<0::1, 0::1, 0::1, 0::5>>,
          values: [<<"21">>, <<"22">>, <<"101">>]
        }
      }

      data3 = %SatOpDelete{
        relation_id: 10,
        old_row_data: %SatOpRow{
          nulls_bitmask: <<0::1, 0::1, 0::1, 0::5>>,
          values: [<<"21">>, <<"22">>, <<"101">>]
        }
      }

      commit = %SatOpCommit{
        commit_timestamp: :os.system_time(:millisecond),
        trans_id: "",
        lsn: "245242342"
      }

      original_msg = %SatOpLog{
        ops: [
          %SatTransOp{op: {:begin, begin}},
          %SatTransOp{op: {:insert, data1}},
          %SatTransOp{op: {:update, data2}},
          %SatTransOp{op: {:delete, data3}},
          %SatTransOp{op: {:commit, commit}}
        ]
      }

      {:ok, type, iodata} = PB.encode(original_msg)

      {:ok, decoded_msg} =
        PB.decode(
          type,
          :erlang.iolist_to_binary(iodata)
        )

      assert original_msg == decoded_msg
    end
  end

  describe "Check version parsing" do
    test "current version of the protocol is parsed properly" do
      version = PB.get_long_proto_vsn()
      parsed = PB.parse_proto_vsn(version)

      {:ok, %PB.Version{major: major, minor: minor}} = parsed
      assert is_integer(major) == true
      assert is_integer(minor) == true
    end

    test "expect properly formed version (Namespace.vMAJOR_MINOR) to be parsed" do
      parsed = PB.parse_proto_vsn("Some.Namespace.v190_0979")

      {:ok, %PB.Version{major: major, minor: minor}} = parsed
      assert {major, minor} == {190, 979}
    end

    test "expect properly formed version (Namespace.vMAJOR_MINOR) to be parsed 2" do
      parsed = PB.parse_proto_vsn("Some.Namespace.v190_0")

      {:ok, %PB.Version{major: major, minor: minor}} = parsed
      assert {major, minor} == {190, 0}
    end

    test "improperly formed version (Namespace.vMAJOR_MINOR) returns error" do
      assert {:error, :bad_version} ==
               PB.parse_proto_vsn("Some.Namespace.v190_0ba:90089")
    end
  end
end
