defmodule Electric.Postgres.PBTest do
  alias Electric.Satellite.PB.Utils

  alias Electric.Satellite.{
    SatAuthReq,
    SatPingReq,
    SatAuthReq,
    SatOpLog,
    SatTransOp,
    SatOpBegin,
    SatOpCommit,
    SatOpInsert,
    SatOpUpdate,
    SatOpDelete
  }

  use ExUnit.Case, async: true

  describe "Decode and encode work correctly" do
    test "message for SatAuthReq is encoded and decoded" do
      original_msg = %SatAuthReq{token: "token"}
      {:ok, type, iodata} = Utils.encode(original_msg)
      {:ok, decoded_msg} = Utils.decode(type, :erlang.iolist_to_binary(iodata))
      assert original_msg == decoded_msg
    end

    test "message for SatPingReq is encoded and decoded" do
      original_msg = %SatPingReq{}
      {:ok, type, iodata} = Utils.encode(original_msg)
      {:ok, decoded_msg} = Utils.decode(type, :erlang.iolist_to_binary(iodata))
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
        row_data: [<<"1">>, <<"2">>, <<"10">>]
      }

      data2 = %SatOpUpdate{
        relation_id: 10,
        row_data: [<<"1">>, <<"2">>, <<"10">>],
        old_row_data: [<<"21">>, <<"22">>, <<"101">>]
      }

      data3 = %SatOpDelete{
        relation_id: 10,
        old_row_data: [<<"21">>, <<"22">>, <<"101">>]
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

      {:ok, type, iodata} = Utils.encode(original_msg)

      {:ok, decoded_msg} =
        Utils.decode(
          type,
          :erlang.iolist_to_binary(iodata)
        )

      assert original_msg == decoded_msg
    end
  end
end
