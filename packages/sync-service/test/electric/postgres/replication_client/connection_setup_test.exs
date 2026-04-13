defmodule Electric.Postgres.ReplicationClient.ConnectionSetupTest do
  use ExUnit.Case, async: true

  alias Electric.Postgres.ReplicationClient.ConnectionSetup
  alias Electric.Postgres.ReplicationClient.State
  alias Electric.Postgres.Lsn

  defp base_state(overrides) do
    Map.merge(
      %State{
        handle_event: fn _, _ -> :ok end,
        publication_name: "test_pub",
        slot_name: "test_slot",
        display_settings: ["SET dummy = 'test'"],
        flushed_wal: 0
      },
      overrides
    )
  end

  describe "process_query_result/2 returns updated state" do
    test "create_slot result includes updated flushed_wal in returned state" do
      slot_lsn = "0/1A2B3C4"
      expected_wal = slot_lsn |> Lsn.from_string() |> Lsn.to_integer()

      state = base_state(%{step: :create_slot})

      create_result = [
        %Postgrex.Result{
          command: :create,
          columns: ["slot_name", "consistent_point", "snapshot_name", "output_plugin"],
          rows: [["test_slot", slot_lsn, nil, "pgoutput"]],
          num_rows: 1
        }
      ]

      {_step, _next_step, :created_new_slot, updated_state, _return_val} =
        ConnectionSetup.process_query_result(create_result, state)

      assert updated_state.flushed_wal == expected_wal
    end

    test "query_slot_flushed_lsn result includes updated flushed_wal in returned state" do
      slot_lsn = "0/5D6E7F8"
      expected_wal = slot_lsn |> Lsn.from_string() |> Lsn.to_integer()

      state = base_state(%{step: :query_slot_flushed_lsn, flushed_wal: 0})

      query_result = [
        %Postgrex.Result{
          command: :select,
          columns: ["confirmed_flush_lsn"],
          rows: [[slot_lsn]],
          num_rows: 1
        }
      ]

      {_step, _next_step, _extra_info, updated_state, _return_val} =
        ConnectionSetup.process_query_result(query_result, state)

      assert updated_state.flushed_wal == expected_wal
    end
  end
end
