defmodule Electric.Replication.TransactionFragmentationTest do
  @moduledoc """
  Integration tests for transaction fragmentation behavior.

  These tests verify that transactions are correctly split into fragments
  when they exceed `max_batch_size` (default: 100), and that all fragments
  (including commit-only fragments at exact batch boundaries) are correctly
  processed through the full pipeline and delivered to clients.

  This tests the fix for a bug where transactions with exactly max_batch_size
  changes had their commit fragment silently dropped because it shared the
  same last_log_offset as the preceding data fragment.
  """
  use ExUnit.Case, async: false

  import Support.ComponentSetup
  import Support.DbSetup
  import Support.DbStructureSetup
  import Support.IntegrationSetup
  import Support.StreamConsumer

  alias Electric.Client

  @moduletag :tmp_dir

  describe "transaction fragmentation with max_batch_size boundary" do
    setup [:with_unique_db, :with_basic_tables, :with_sql_execute]
    setup :with_complete_stack
    setup :with_electric_client

    test "transaction with exactly 100 rows (max_batch_size) is fully received",
         %{client: client, db_conn: db_conn} do
      # This test verifies the fix for the bug where transactions with exactly
      # max_batch_size (100) changes had their commit fragment dropped.
      #
      # Before the fix:
      # - Fragment 1 (100 data changes) had last_log_offset = (final_lsn, 198)
      # - Fragment 2 (commit only) had last_log_offset = (final_lsn, 198) <- SAME!
      # - ShapeLogCollector dropped Fragment 2 as duplicate
      # - Client never received complete transaction
      #
      # After the fix:
      # - Fragment 2 uses end_lsn (which is > final_lsn) for its offset
      # - Both fragments are processed
      # - Client receives all 100 rows

      stream = Client.stream(client, "items", live: true)

      with_consumer stream do
        # Wait for initial up-to-date
        assert_up_to_date(consumer)

        # Insert exactly 100 rows in a single transaction
        # This triggers the exact batch boundary case
        Postgrex.transaction(db_conn, fn conn ->
          for i <- 1..100 do
            id = Ecto.UUID.bingenerate()

            Postgrex.query!(
              conn,
              "INSERT INTO items (id, value) VALUES ($1, $2)",
              [id, "value-#{i}"]
            )
          end
        end)

        # All 100 rows should be received
        for i <- 1..100 do
          assert_insert(consumer, %{"value" => "value-#{i}"})
        end
      end
    end

    test "transaction with 99 rows (below max_batch_size) is fully received",
         %{client: client, db_conn: db_conn} do
      # Sanity check: transactions below the boundary work fine
      stream = Client.stream(client, "items", live: true)

      with_consumer stream do
        assert_up_to_date(consumer)

        Postgrex.transaction(db_conn, fn conn ->
          for i <- 1..99 do
            id = Ecto.UUID.bingenerate()

            Postgrex.query!(
              conn,
              "INSERT INTO items (id, value) VALUES ($1, $2)",
              [id, "value-#{i}"]
            )
          end
        end)

        for i <- 1..99 do
          assert_insert(consumer, %{"value" => "value-#{i}"})
        end
      end
    end

    test "transaction with 101 rows (above max_batch_size) is fully received",
         %{client: client, db_conn: db_conn} do
      # Transactions above the boundary also work
      stream = Client.stream(client, "items", live: true)

      with_consumer stream do
        assert_up_to_date(consumer)

        Postgrex.transaction(db_conn, fn conn ->
          for i <- 1..101 do
            id = Ecto.UUID.bingenerate()

            Postgrex.query!(
              conn,
              "INSERT INTO items (id, value) VALUES ($1, $2)",
              [id, "value-#{i}"]
            )
          end
        end)

        for i <- 1..101 do
          assert_insert(consumer, %{"value" => "value-#{i}"})
        end
      end
    end

    test "transaction with exactly 200 rows (2x max_batch_size) is fully received",
         %{client: client, db_conn: db_conn} do
      # Edge case: exactly 2x the batch size
      # This creates 3 fragments: 100 data + 100 data + commit
      stream = Client.stream(client, "items", live: true)

      with_consumer stream do
        assert_up_to_date(consumer)

        Postgrex.transaction(db_conn, fn conn ->
          for i <- 1..200 do
            id = Ecto.UUID.bingenerate()

            Postgrex.query!(
              conn,
              "INSERT INTO items (id, value) VALUES ($1, $2)",
              [id, "value-#{i}"]
            )
          end
        end)

        for i <- 1..200 do
          assert_insert(consumer, %{"value" => "value-#{i}"})
        end
      end
    end
  end
end
