defmodule Electric.Replication.TransactionFragmentationTest do
  @moduledoc """
  Integration tests for transaction fragmentation behavior.

  These tests verify that transactions are correctly split into fragments when they exceed
  `max_batch_size`, and that all fragments (including commit-only fragments at exact batch
  boundaries) are correctly processed through the full pipeline and delivered to clients.
  """
  use ExUnit.Case, async: false

  import Support.ComponentSetup
  import Support.DbSetup
  import Support.DbStructureSetup
  import Support.IntegrationSetup
  import Support.StreamConsumer

  alias Electric.Client

  @max_batch_size 10

  @moduletag :tmp_dir
  @moduletag replication_opts_overrides: [max_batch_size: @max_batch_size]

  setup [:with_unique_db, :with_basic_tables, :with_sql_execute]
  setup :with_complete_stack
  setup :with_electric_client

  for num_changes <- [
        # exactly max_batch_size
        @max_batch_size,
        # slightly less
        @max_batch_size - 1,
        # slightly more
        @max_batch_size + 1,
        # multiple of
        @max_batch_size * 2
      ] do
    @num_changes num_changes
    test "transaction with #{@num_changes} rows (max_batch_size=#{@max_batch_size}) is fully received",
         %{client: client, db_conn: db_conn} do
      # This test verifies the fix for the bug where transactions with exactly
      # max_batch_size changes had their commit fragment dropped.
      #
      # Before the fix:
      # - Fragment 1 (100 data changes) had last_log_offset = (final_lsn, 198)
      # - Fragment 2 (commit only) had last_log_offset = (final_lsn, 198) <- SAME!
      # - ShapeLogCollector dropped Fragment 2 as duplicate
      # - Client never received complete transaction
      #
      # After the fix:
      # - Fragment 1 actually gets one less change
      # - By holding 1st fragment's last change until the next fragment,
      #   we make sure that no two fragments have the same last_log_offset

      stream = Client.stream(client, "items", live: true)

      with_consumer stream do
        assert_up_to_date(consumer)

        Postgrex.transaction(db_conn, fn conn ->
          for i <- 1..@num_changes do
            Postgrex.query!(
              conn,
              "INSERT INTO items (id, value) VALUES (gen_random_uuid(), $1)",
              ["value-#{i}"]
            )
          end
        end)

        # Verify that all rows have been received by the client
        for i <- 1..@num_changes do
          assert_insert(consumer, %{"value" => "value-#{i}"})
        end
      end
    end
  end
end
