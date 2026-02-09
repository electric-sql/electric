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

  # max_batch_size must be at least 2, at least 3 for this test
  @max_batch_size :rand.uniform(50) + 2

  @moduletag :tmp_dir
  @moduletag replication_opts_overrides: [max_batch_size: @max_batch_size]

  setup [:with_unique_db, :with_basic_tables, :with_sql_execute]
  setup :with_complete_stack
  setup :with_electric_client

  random_int_in = fn lo..hi//_ ->
    lo + :rand.uniform(hi - lo + 1) - 1
  end

  # returns random value within 80-99% of the argument
  slightly_less = fn n ->
    lo = trunc(n * 0.8)
    hi = n - 1
    random_int_in.(lo..hi)
  end

  # returns random value within 101-120% of the argument
  slightly_more = fn n ->
    lo = n + 1
    hi = round(n * 1.2)
    random_int_in.(lo..hi)
  end

  for num_changes <- [
        @max_batch_size,
        slightly_less.(@max_batch_size),
        slightly_more.(@max_batch_size),
        # multiple of
        @max_batch_size * random_int_in.(2..5)
      ] do
    @num_changes num_changes
    @tag additional_fields: "val text"
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

      ## Pre-seed the DB with enough rows to be able to generate UPDATEs and DELETEs freely

      Postgrex.query!(
        db_conn,
        "INSERT INTO serial_ids (id, val) SELECT generate_series, 'value-' || generate_series FROM generate_series(1, $1)",
        [@num_changes]
      )

      # Skip the first inserts before moving to the actual generation of a txn with random ops
      match_fn = fn %Electric.Client.Message.ChangeMessage{
                      headers: %{operation: :insert, relation: ["public", "serial_ids"]}
                    } ->
        true
      end

      resume =
        with_consumer Client.stream(client, "serial_ids", live: false) do
          await_count(consumer, @num_changes, match: match_fn)
          assert_up_to_date(consumer)
          assert_resume(consumer)
        end

      ## Generate @num_changes random ops and assert that they are all received by the client

      ops = Stream.repeatedly(fn -> Enum.random([:insert, :update, :delete]) end)
      indexed_ops = Enum.zip(1..@num_changes, ops)
      assert @num_changes == length(indexed_ops)

      # Create a single transaction with @num_changes ops
      Postgrex.transaction(db_conn, fn conn ->
        Stream.map(indexed_ops, fn
          {i, :insert} ->
            id = @num_changes + i
            {"INSERT INTO serial_ids (id, val) VALUES ($1, $2)", [id, "value-#{id}"]}

          {i, :update} ->
            {"UPDATE serial_ids SET val = $1 WHERE id = $2", ["value-#{i}-upd", i]}

          {i, :delete} ->
            {"DELETE FROM serial_ids WHERE id = $1", [i]}
        end)
        |> Enum.each(fn {sql, args} -> Postgrex.query!(conn, sql, args) end)
      end)

      stream = Client.stream(client, "serial_ids", live: false, resume: resume)

      {received_ins, received_upds, received_dels} =
        with_consumer stream do
          # Verify that all ops have been received by the client
          Enum.reduce(indexed_ops, {0, 0, 0}, fn
            {i, :insert}, {ins, ups, dels} ->
              assert_insert(consumer, %{"val" => "value-#{@num_changes + i}"})
              {ins + 1, ups, dels}

            {i, :update}, {ins, ups, dels} ->
              assert_update(consumer, %{"val" => "value-#{i}-upd"})
              {ins, ups + 1, dels}

            {i, :delete}, {ins, ups, dels} ->
              assert_delete(consumer, %{"id" => i})
              {ins, ups, dels + 1}
          end)
        end

      assert received_ins == Enum.count(indexed_ops, fn {_, op} -> op == :insert end)
      assert received_upds == Enum.count(indexed_ops, fn {_, op} -> op == :update end)
      assert received_dels == Enum.count(indexed_ops, fn {_, op} -> op == :delete end)
    end
  end
end
