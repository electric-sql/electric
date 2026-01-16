defmodule Electric.Integration.BatchOperationsTest do
  @moduledoc """
  Integration tests for batch operations (INSERT, UPDATE, DELETE).

  Verifies that batch operations with multiple rows in single statements
  and multi-statement transactions are properly replicated by the sync service.
  Tests cover:
  - Single-statement batch INSERT/UPDATE/DELETE operations
  - Multi-statement transactions with multiple individual statements
  - Mixed operation transactions (INSERT + UPDATE + DELETE combinations)
  """
  use ExUnit.Case, async: false

  import Support.ComponentSetup
  import Support.DbSetup
  import Support.DbStructureSetup
  import Support.IntegrationSetup
  import Support.StreamConsumer

  alias Electric.Client
  alias Electric.Client.Message.ChangeMessage

  @moduletag :tmp_dir

  # This should match @max_change_batch_size in Electric.Postgres.ReplicationClient.
  # The value 100 is set in ReplicationClient to balance performance (avoiding message
  # passing overhead) and memory usage. If that value changes, update this constant.
  @max_change_batch_size 100

  describe "batch INSERT replication" do
    setup [:with_unique_db, :with_basic_tables, :with_sql_execute]
    setup :with_complete_stack
    setup :with_electric_client

    batch_sizes =
      [
        @max_change_batch_size - 25,
        @max_change_batch_size - 1,
        @max_change_batch_size,
        @max_change_batch_size + 1,
        @max_change_batch_size + 25,
        @max_change_batch_size * 2,
        @max_change_batch_size * 3,
        @max_change_batch_size * 4,
        @max_change_batch_size * 5
      ]
      |> Enum.uniq()
      |> Enum.sort()

    for batch_size <- batch_sizes do
      timeout = if batch_size <= 75, do: 10_000, else: 30_000
      verify_all = batch_size <= 75

      test "batch insert (#{batch_size})", %{client: client, db_conn: db_conn} do
        test_batch_insert(
          client,
          db_conn,
          unquote(batch_size),
          unquote(timeout),
          unquote(verify_all)
        )
      end
    end
  end

  describe "batch UPDATE replication" do
    setup [:with_unique_db, :with_basic_tables, :with_sql_execute]
    setup :with_complete_stack
    setup :with_electric_client

    batch_sizes =
      [
        @max_change_batch_size - 25,
        @max_change_batch_size - 1,
        @max_change_batch_size,
        @max_change_batch_size + 1,
        @max_change_batch_size + 25,
        @max_change_batch_size * 2,
        @max_change_batch_size * 3,
        @max_change_batch_size * 4,
        @max_change_batch_size * 5
      ]
      |> Enum.uniq()
      |> Enum.sort()

    for batch_size <- batch_sizes do
      timeout = if batch_size <= 75, do: 10_000, else: 30_000
      verify_all = batch_size <= 75

      test "batch update (#{batch_size})", %{client: client, db_conn: db_conn} do
        test_batch_update(
          client,
          db_conn,
          unquote(batch_size),
          unquote(timeout),
          unquote(verify_all)
        )
      end
    end
  end

  describe "batch DELETE replication" do
    setup [:with_unique_db, :with_basic_tables, :with_sql_execute]
    setup :with_complete_stack
    setup :with_electric_client

    batch_sizes =
      [
        @max_change_batch_size - 25,
        @max_change_batch_size - 1,
        @max_change_batch_size,
        @max_change_batch_size + 1,
        @max_change_batch_size + 25,
        @max_change_batch_size * 2,
        @max_change_batch_size * 3,
        @max_change_batch_size * 4,
        @max_change_batch_size * 5
      ]
      |> Enum.uniq()
      |> Enum.sort()

    for batch_size <- batch_sizes do
      timeout = if batch_size <= 75, do: 10_000, else: 30_000
      verify_all = batch_size <= 75

      test "batch delete (#{batch_size})", %{client: client, db_conn: db_conn} do
        test_batch_delete(
          client,
          db_conn,
          unquote(batch_size),
          unquote(timeout),
          unquote(verify_all)
        )
      end
    end
  end

  describe "multi-statement transaction replication" do
    setup [:with_unique_db, :with_basic_tables, :with_sql_execute]
    setup :with_complete_stack
    setup :with_electric_client

    test "100 individual INSERTs", %{client: client, db_conn: db_conn} do
      test_multi_statement_txn(client, db_conn, :insert, 100, 30_000)
    end

    test "100 individual UPDATEs", %{client: client, db_conn: db_conn} do
      test_multi_statement_txn(client, db_conn, :update, 100, 30_000)
    end

    test "100 individual DELETEs", %{client: client, db_conn: db_conn} do
      test_multi_statement_txn(client, db_conn, :delete, 100, 30_000)
    end
  end

  describe "mixed operation transaction replication" do
    setup [:with_unique_db, :with_basic_tables, :with_sql_execute]
    setup :with_complete_stack
    setup :with_electric_client

    test "50 INSERTs + 50 UPDATEs", %{client: client, db_conn: db_conn} do
      test_mixed_operation_txn(client, db_conn, [{:insert, 50}, {:update, 50}], 30_000)
    end

    test "33 INSERTs + 33 UPDATEs + 34 DELETEs", %{client: client, db_conn: db_conn} do
      test_mixed_operation_txn(
        client,
        db_conn,
        [{:insert, 33}, {:update, 33}, {:delete, 34}],
        30_000
      )
    end

    test "25 INSERTs + 25 UPDATEs + 25 DELETEs + 25 INSERTs", %{client: client, db_conn: db_conn} do
      test_mixed_operation_txn(
        client,
        db_conn,
        [{:insert, 25}, {:update, 25}, {:delete, 25}, {:insert, 25}],
        30_000
      )
    end
  end

  describe "sequential transaction replication" do
    setup [:with_unique_db, :with_basic_tables, :with_sql_execute]
    setup :with_complete_stack
    setup :with_electric_client

    test "sequential txn varying sizes", %{client: client, db_conn: db_conn} do
      test_sequential_transactions(
        client,
        db_conn,
        [
          {:insert, 25},
          {:insert, 100},
          {:insert, 5}
        ],
        30_000
      )
    end

    test "sequential txn batch boundary", %{client: client, db_conn: db_conn} do
      test_sequential_transactions(
        client,
        db_conn,
        [
          {:insert, 25},
          {:insert, @max_change_batch_size},
          {:insert, @max_change_batch_size + 1},
          {:insert, 5}
        ],
        30_000
      )
    end

    test "sequential txn mixed ops", %{client: client, db_conn: db_conn} do
      test_sequential_transactions_with_mixed_ops(
        client,
        db_conn,
        [
          {:insert, 25},
          {:update, 100},
          {:insert, 50},
          {:delete, 50},
          {:insert, 5}
        ],
        30_000
      )
    end
  end

  # Helper functions

  defp test_batch_insert(client, db_conn, batch_size, timeout, verify_all_rows) do
    stream = Client.stream(client, "items", live: true)

    with_consumer stream do
      assert_up_to_date(consumer)

      # Generate test data
      test_data = generate_test_data(batch_size)

      # Perform batch insert
      execute_batch_insert(db_conn, test_data)

      # Verify the insert actually happened in the database
      %Postgrex.Result{rows: rows} =
        Postgrex.query!(db_conn, "SELECT COUNT(*) FROM items", [])

      db_count = List.first(List.first(rows))

      assert db_count == batch_size,
             "Expected #{batch_size} rows in database, but found #{db_count}. Batch insert may have failed."

      messages = collect_all_inserts(consumer, batch_size, timeout)

      assert length(messages) == batch_size,
             "Expected #{batch_size} messages from batch insert, got #{length(messages)}. " <>
               "This indicates batch inserts may not be properly replicated."

      if verify_all_rows do
        verify_all_rows_present(messages, test_data)
      else
        verify_sample_rows(messages, test_data)
      end
    end
  end

  defp collect_all_inserts(consumer, expected_count, total_timeout) do
    case await_count(consumer, expected_count,
           match: fn
             %ChangeMessage{headers: %{operation: :insert}} -> true
             _ -> false
           end,
           timeout: total_timeout
         ) do
      {:ok, messages} ->
        messages

      {:error, :timeout} ->
        collect_messages(consumer,
          match: fn
            %ChangeMessage{headers: %{operation: :insert}} -> true
            _ -> false
          end,
          timeout: 1_000
        )
    end
  end

  defp generate_uuid(seed) do
    seed_str = String.pad_leading(Integer.to_string(seed), 12, "0")
    "00000000-0000-0000-0000-#{seed_str}"
  end

  defp execute_batch_insert(db_conn, test_data) do
    values_clause =
      test_data
      |> Enum.map(fn {id, value} ->
        escaped_id = String.replace(id, "'", "''")
        escaped_value = String.replace(value, "'", "''")
        "('#{escaped_id}', '#{escaped_value}')"
      end)
      |> Enum.join(",\n      ")

    sql = """
    INSERT INTO items VALUES
      #{values_clause}
    """

    Postgrex.query!(db_conn, sql, [])
  end

  defp verify_all_rows_present(messages, test_data) do
    values = Enum.map(messages, fn %ChangeMessage{value: value} -> value end)

    for {id, expected_value} <- test_data do
      expected = %{"id" => id, "value" => expected_value}

      assert Enum.any?(values, fn v -> v == expected end),
             "Expected value #{inspect(expected)} not found"
    end
  end

  defp verify_sample_rows(messages, test_data) do
    values = Enum.map(messages, fn %ChangeMessage{value: value} -> value end)

    sample_indices = [0, div(length(test_data), 2), length(test_data) - 1]

    for idx <- sample_indices do
      {id, expected_value} = Enum.at(test_data, idx)
      expected = %{"id" => id, "value" => expected_value}

      assert Enum.any?(values, fn v -> v == expected end),
             "Expected sample value #{inspect(expected)} not found"
    end
  end

  # Batch UPDATE helpers

  defp test_batch_update(client, db_conn, batch_size, timeout, verify_all_rows) do
    stream = Client.stream(client, "items", live: true)

    with_consumer stream do
      assert_up_to_date(consumer)

      # First, insert data to update
      test_data = generate_test_data(batch_size)
      execute_batch_insert(db_conn, test_data)

      # Wait for inserts to be processed
      collect_all_inserts(consumer, batch_size, timeout)

      # Now perform batch update
      execute_batch_update(db_conn, test_data)

      # Verify the update actually happened in the database
      %Postgrex.Result{rows: rows} =
        Postgrex.query!(db_conn, "SELECT COUNT(*) FROM items WHERE value = 'updated value'", [])

      db_count = List.first(List.first(rows))

      assert db_count == batch_size,
             "Expected #{batch_size} updated rows in database, but found #{db_count}. Batch update may have failed."

      messages = collect_all_updates(consumer, batch_size, timeout)

      assert length(messages) == batch_size,
             "Expected #{batch_size} update messages from batch update, got #{length(messages)}. " <>
               "This indicates batch updates may not be properly replicated."

      if verify_all_rows do
        verify_all_updates_present(messages, test_data)
      else
        verify_sample_updates(messages, test_data)
      end
    end
  end

  defp execute_batch_update(db_conn, test_data) do
    ids = Enum.map(test_data, fn {id, _value} -> id end)

    ids_clause =
      ids
      |> Enum.map(fn id ->
        escaped_id = String.replace(id, "'", "''")
        "'#{escaped_id}'"
      end)
      |> Enum.join(", ")

    sql = """
    UPDATE items SET value = 'updated value' WHERE id IN (#{ids_clause})
    """

    Postgrex.query!(db_conn, sql, [])
  end

  defp collect_all_updates(consumer, expected_count, total_timeout) do
    case await_count(consumer, expected_count,
           match: fn
             %ChangeMessage{headers: %{operation: :update}} -> true
             _ -> false
           end,
           timeout: total_timeout
         ) do
      {:ok, messages} ->
        messages

      {:error, :timeout} ->
        collect_messages(consumer,
          match: fn
            %ChangeMessage{headers: %{operation: :update}} -> true
            _ -> false
          end,
          timeout: 1_000
        )
    end
  end

  defp verify_all_updates_present(messages, test_data) do
    values = Enum.map(messages, fn %ChangeMessage{value: value} -> value end)

    for {id, _original_value} <- test_data do
      expected = %{"id" => id, "value" => "updated value"}

      assert Enum.any?(values, fn v -> v == expected end),
             "Expected updated value #{inspect(expected)} not found"
    end
  end

  defp verify_sample_updates(messages, test_data) do
    values = Enum.map(messages, fn %ChangeMessage{value: value} -> value end)

    sample_indices = [0, div(length(test_data), 2), length(test_data) - 1]

    for idx <- sample_indices do
      {id, _original_value} = Enum.at(test_data, idx)
      expected = %{"id" => id, "value" => "updated value"}

      assert Enum.any?(values, fn v -> v == expected end),
             "Expected sample updated value #{inspect(expected)} not found"
    end
  end

  # Batch DELETE helpers

  defp test_batch_delete(client, db_conn, batch_size, timeout, verify_all_rows) do
    stream = Client.stream(client, "items", live: true)

    with_consumer stream do
      assert_up_to_date(consumer)

      # First, insert data to delete
      test_data = generate_test_data(batch_size)
      execute_batch_insert(db_conn, test_data)

      # Wait for inserts to be processed
      collect_all_inserts(consumer, batch_size, timeout)

      # Now perform batch delete
      execute_batch_delete(db_conn, test_data)

      # Verify the delete actually happened in the database
      %Postgrex.Result{rows: rows} =
        Postgrex.query!(db_conn, "SELECT COUNT(*) FROM items", [])

      db_count = List.first(List.first(rows))

      assert db_count == 0,
             "Expected 0 rows in database after batch delete, but found #{db_count}. Batch delete may have failed."

      messages = collect_all_deletes(consumer, batch_size, timeout)

      assert length(messages) == batch_size,
             "Expected #{batch_size} delete messages from batch delete, got #{length(messages)}. " <>
               "This indicates batch deletes may not be properly replicated."

      if verify_all_rows do
        verify_all_deletes_present(messages, test_data)
      else
        verify_sample_deletes(messages, test_data)
      end
    end
  end

  defp execute_batch_delete(db_conn, test_data) do
    ids = Enum.map(test_data, fn {id, _value} -> id end)

    ids_clause =
      ids
      |> Enum.map(fn id ->
        escaped_id = String.replace(id, "'", "''")
        "'#{escaped_id}'"
      end)
      |> Enum.join(", ")

    sql = """
    DELETE FROM items WHERE id IN (#{ids_clause})
    """

    Postgrex.query!(db_conn, sql, [])
  end

  defp collect_all_deletes(consumer, expected_count, total_timeout) do
    case await_count(consumer, expected_count,
           match: fn
             %ChangeMessage{headers: %{operation: :delete}} -> true
             _ -> false
           end,
           timeout: total_timeout
         ) do
      {:ok, messages} ->
        messages

      {:error, :timeout} ->
        collect_messages(consumer,
          match: fn
            %ChangeMessage{headers: %{operation: :delete}} -> true
            _ -> false
          end,
          timeout: 1_000
        )
    end
  end

  defp verify_all_deletes_present(messages, test_data) do
    # DELETE messages may only contain primary key columns, so we only verify IDs
    ids = Enum.map(messages, fn %ChangeMessage{value: value} -> Map.get(value, "id") end)
    expected_ids = Enum.map(test_data, fn {id, _value} -> id end)

    for expected_id <- expected_ids do
      assert Enum.member?(ids, expected_id),
             "Expected deleted ID #{inspect(expected_id)} not found in delete messages"
    end
  end

  defp verify_sample_deletes(messages, test_data) do
    # DELETE messages may only contain primary key columns, so we only verify IDs
    ids = Enum.map(messages, fn %ChangeMessage{value: value} -> Map.get(value, "id") end)

    sample_indices = [0, div(length(test_data), 2), length(test_data) - 1]

    for idx <- sample_indices do
      {expected_id, _expected_value} = Enum.at(test_data, idx)

      assert Enum.member?(ids, expected_id),
             "Expected sample deleted ID #{inspect(expected_id)} not found in delete messages"
    end
  end

  # Multi-statement transaction helpers

  defp test_multi_statement_txn(client, db_conn, operation, count, timeout) do
    stream = Client.stream(client, "items", live: true)

    with_consumer stream do
      assert_up_to_date(consumer)

      # For UPDATE and DELETE, we need to insert data first
      if operation in [:update, :delete] do
        test_data = generate_test_data(count)
        execute_batch_insert(db_conn, test_data)
        collect_all_inserts(consumer, count, timeout)
      end

      # Execute multiple statements in a transaction
      execute_multi_statement_txn(db_conn, operation, count)

      # Verify the operation actually happened in the database
      case operation do
        :insert ->
          %Postgrex.Result{rows: rows} =
            Postgrex.query!(db_conn, "SELECT COUNT(*) FROM items", [])

          db_count = List.first(List.first(rows))

          assert db_count == count,
                 "Expected #{count} rows in database, but found #{db_count}. Multi-statement insert may have failed."

        :update ->
          %Postgrex.Result{rows: rows} =
            Postgrex.query!(
              db_conn,
              "SELECT COUNT(*) FROM items WHERE value = 'updated value'",
              []
            )

          db_count = List.first(List.first(rows))

          assert db_count == count,
                 "Expected #{count} updated rows in database, but found #{db_count}. Multi-statement update may have failed."

        :delete ->
          %Postgrex.Result{rows: rows} =
            Postgrex.query!(db_conn, "SELECT COUNT(*) FROM items", [])

          db_count = List.first(List.first(rows))
          expected_count = if operation == :delete, do: 0, else: count

          assert db_count == expected_count,
                 "Expected #{expected_count} rows in database, but found #{db_count}. Multi-statement delete may have failed."
      end

      messages = collect_all_changes(consumer, operation, count, timeout)

      assert length(messages) == count,
             "Expected #{count} #{operation} messages from multi-statement transaction, got #{length(messages)}. " <>
               "This indicates multi-statement transactions may not be properly replicated."
    end
  end

  defp execute_multi_statement_txn(db_conn, operation, count) do
    Postgrex.transaction(db_conn, fn conn ->
      for i <- 1..count do
        id = generate_uuid(i)
        escaped_id = String.replace(id, "'", "''")

        case operation do
          :insert ->
            value = "multi value #{i}"
            escaped_value = String.replace(value, "'", "''")

            Postgrex.query!(
              conn,
              "INSERT INTO items VALUES ('#{escaped_id}', '#{escaped_value}')",
              []
            )

          :update ->
            Postgrex.query!(
              conn,
              "UPDATE items SET value = 'updated value' WHERE id = '#{escaped_id}'",
              []
            )

          :delete ->
            Postgrex.query!(conn, "DELETE FROM items WHERE id = '#{escaped_id}'", [])
        end
      end
    end)
  end

  defp collect_all_changes(consumer, operation, expected_count, total_timeout) do
    case await_count(consumer, expected_count,
           match: fn
             %ChangeMessage{headers: %{operation: op}} when op == operation -> true
             _ -> false
           end,
           timeout: total_timeout
         ) do
      {:ok, messages} ->
        messages

      {:error, :timeout} ->
        collect_messages(consumer,
          match: fn
            %ChangeMessage{headers: %{operation: op}} when op == operation -> true
            _ -> false
          end,
          timeout: 1_000
        )
    end
  end

  # Mixed operation transaction helpers

  defp test_mixed_operation_txn(client, db_conn, operations, timeout) do
    stream = Client.stream(client, "items", live: true)

    with_consumer stream do
      assert_up_to_date(consumer)

      # Calculate total expected changes
      total_changes = Enum.reduce(operations, 0, fn {_op, count}, acc -> acc + count end)

      # For UPDATE and DELETE operations, we need to insert data first
      # We'll track which IDs to use for each UPDATE/DELETE operation
      # Also track the starting ID for INSERT operations to avoid conflicts
      {pre_insert_data, id_list, insert_start_id} = prepare_mixed_operation_data(operations)

      if length(pre_insert_data) > 0 do
        execute_batch_insert(db_conn, pre_insert_data)
        collect_all_inserts(consumer, length(pre_insert_data), timeout)
      end

      # Execute mixed operations in a transaction
      execute_mixed_operation_txn(db_conn, operations, id_list, insert_start_id)

      # Verify the operations actually happened in the database
      %Postgrex.Result{rows: rows} =
        Postgrex.query!(db_conn, "SELECT COUNT(*) FROM items", [])

      db_count = List.first(List.first(rows))

      # Calculate expected final count
      # Start with pre-inserted rows, add INSERTs, subtract DELETEs
      pre_insert_count = length(pre_insert_data)

      expected_final_count =
        Enum.reduce(operations, pre_insert_count, fn
          {:insert, count}, acc -> acc + count
          {:update, _count}, acc -> acc
          {:delete, count}, acc -> acc - count
        end)

      assert db_count == expected_final_count,
             "Expected #{expected_final_count} rows in database, but found #{db_count}. Mixed operation transaction may have failed."

      messages = collect_all_changes_mixed(consumer, total_changes, timeout)

      assert length(messages) == total_changes,
             "Expected #{total_changes} change messages from mixed operation transaction, got #{length(messages)}. " <>
               "This indicates mixed operation transactions may not be properly replicated."
    end
  end

  defp prepare_mixed_operation_data(operations) do
    # Generate IDs for all UPDATE and DELETE operations
    # We'll track which IDs belong to which operation in sequence
    # Also track the next available ID for INSERT operations
    {pre_insert_data, id_list, next_insert_id} =
      Enum.reduce(operations, {[], [], 1}, fn {operation, count}, {pre_data, id_list, counter} ->
        case operation do
          :insert ->
            # INSERT operations don't need pre-inserted data, but we track the counter
            {pre_data, id_list, counter + count}

          :update ->
            # Generate test data for UPDATE operations
            new_data = generate_test_data(count, counter)
            new_ids = Enum.map(new_data, fn {id, _value} -> id end)
            {pre_data ++ new_data, id_list ++ [{:update, new_ids}], counter + count}

          :delete ->
            # Generate test data for DELETE operations
            new_data = generate_test_data(count, counter)
            new_ids = Enum.map(new_data, fn {id, _value} -> id end)
            {pre_data ++ new_data, id_list ++ [{:delete, new_ids}], counter + count}
        end
      end)

    {pre_insert_data, id_list, next_insert_id}
  end

  defp generate_test_data(count, start_index \\ 1) do
    for i <- 1..count do
      id = generate_uuid(start_index + i - 1)
      value = "batch value #{start_index + i - 1}"
      {id, value}
    end
  end

  defp execute_mixed_operation_txn(db_conn, operations, id_list, insert_start_id) do
    Postgrex.transaction(db_conn, fn conn ->
      id_counter = insert_start_id
      id_list_index = 0

      {_final_counter, _final_index} =
        Enum.reduce(operations, {id_counter, id_list_index}, fn {operation, count},
                                                                {counter, list_idx} ->
          ids_to_use =
            case operation do
              :insert ->
                # Generate new IDs for INSERT operations, starting from insert_start_id
                for i <- 1..count do
                  generate_uuid(counter + i - 1)
                end

              :update ->
                # Use IDs from pre-inserted data (from id_list)
                {_op, ids} = Enum.at(id_list, list_idx)
                ids

              :delete ->
                # Use IDs from pre-inserted data (from id_list)
                {_op, ids} = Enum.at(id_list, list_idx)
                ids
            end

          for {id, idx} <- Enum.with_index(ids_to_use) do
            escaped_id = String.replace(id, "'", "''")

            case operation do
              :insert ->
                value = "mixed value #{counter + idx}"
                escaped_value = String.replace(value, "'", "''")

                Postgrex.query!(
                  conn,
                  "INSERT INTO items VALUES ('#{escaped_id}', '#{escaped_value}')",
                  []
                )

              :update ->
                Postgrex.query!(
                  conn,
                  "UPDATE items SET value = 'updated value' WHERE id = '#{escaped_id}'",
                  []
                )

              :delete ->
                Postgrex.query!(conn, "DELETE FROM items WHERE id = '#{escaped_id}'", [])
            end
          end

          new_counter = if operation == :insert, do: counter + count, else: counter
          new_list_idx = if operation in [:update, :delete], do: list_idx + 1, else: list_idx

          {new_counter, new_list_idx}
        end)
    end)
  end

  defp collect_all_changes_mixed(consumer, expected_count, total_timeout) do
    case await_count(consumer, expected_count,
           match: fn
             %ChangeMessage{headers: %{operation: op}} when op in [:insert, :update, :delete] ->
               true

             _ ->
               false
           end,
           timeout: total_timeout
         ) do
      {:ok, messages} ->
        messages

      {:error, :timeout} ->
        collect_messages(consumer,
          match: fn
            %ChangeMessage{headers: %{operation: op}} when op in [:insert, :update, :delete] ->
              true

            _ ->
              false
          end,
          timeout: 1_000
        )
    end
  end

  # Sequential transaction helpers

  defp test_sequential_transactions(client, db_conn, transactions, timeout) do
    stream = Client.stream(client, "items", live: true)

    with_consumer stream do
      assert_up_to_date(consumer)

      # Calculate total expected changes
      total_changes = Enum.reduce(transactions, 0, fn {_op, count}, acc -> acc + count end)

      # Execute sequential transactions
      execute_sequential_transactions(db_conn, transactions)

      # Verify the operations actually happened in the database
      %Postgrex.Result{rows: rows} =
        Postgrex.query!(db_conn, "SELECT COUNT(*) FROM items", [])

      db_count = List.first(List.first(rows))

      # Calculate expected final count (only INSERTs add rows)
      expected_final_count =
        Enum.reduce(transactions, 0, fn
          {:insert, count}, acc -> acc + count
          {:update, _count}, acc -> acc
          {:delete, count}, acc -> acc - count
        end)

      assert db_count == expected_final_count,
             "Expected #{expected_final_count} rows in database, but found #{db_count}. Sequential transactions may have failed."

      # Collect all changes from all transactions
      messages = collect_all_changes_mixed(consumer, total_changes, timeout)

      assert length(messages) == total_changes,
             "Expected #{total_changes} change messages from sequential transactions, got #{length(messages)}. " <>
               "This indicates sequential transactions may not be properly replicated."
    end
  end

  defp execute_sequential_transactions(db_conn, transactions) do
    id_counter = 1

    Enum.reduce(transactions, id_counter, fn {operation, count}, counter ->
      Postgrex.transaction(db_conn, fn conn ->
        for i <- 1..count do
          id = generate_uuid(counter + i - 1)
          escaped_id = String.replace(id, "'", "''")

          case operation do
            :insert ->
              value = "seq value #{counter + i - 1}"
              escaped_value = String.replace(value, "'", "''")

              Postgrex.query!(
                conn,
                "INSERT INTO items VALUES ('#{escaped_id}', '#{escaped_value}')",
                []
              )

            :update ->
              Postgrex.query!(
                conn,
                "UPDATE items SET value = 'updated value' WHERE id = '#{escaped_id}'",
                []
              )

            :delete ->
              Postgrex.query!(conn, "DELETE FROM items WHERE id = '#{escaped_id}'", [])
          end
        end
      end)

      counter + if operation == :insert, do: count, else: 0
    end)
  end

  defp test_sequential_transactions_with_mixed_ops(client, db_conn, transactions, timeout) do
    stream = Client.stream(client, "items", live: true)

    with_consumer stream do
      assert_up_to_date(consumer)

      # Calculate total expected changes
      total_changes = Enum.reduce(transactions, 0, fn {_op, count}, acc -> acc + count end)

      # Track which IDs to use for UPDATE/DELETE operations
      {pre_insert_data, id_list, insert_start_id} = prepare_sequential_mixed_data(transactions)

      # Pre-insert data needed for UPDATE/DELETE operations
      if length(pre_insert_data) > 0 do
        execute_batch_insert(db_conn, pre_insert_data)
        # Wait for pre-inserts to be processed before starting sequential transactions
        collect_all_inserts(consumer, length(pre_insert_data), timeout)
      end

      # Execute sequential transactions with mixed operations
      execute_sequential_transactions_mixed(db_conn, transactions, id_list, insert_start_id)

      # Verify the operations actually happened in the database
      %Postgrex.Result{rows: rows} =
        Postgrex.query!(db_conn, "SELECT COUNT(*) FROM items", [])

      db_count = List.first(List.first(rows))

      # Calculate expected final count
      pre_insert_count = length(pre_insert_data)

      expected_final_count =
        Enum.reduce(transactions, pre_insert_count, fn
          {:insert, count}, acc -> acc + count
          {:update, _count}, acc -> acc
          {:delete, count}, acc -> acc - count
        end)

      assert db_count == expected_final_count,
             "Expected #{expected_final_count} rows in database, but found #{db_count}. Sequential mixed transactions may have failed."

      # Collect all changes from all transactions
      messages = collect_all_changes_mixed(consumer, total_changes, timeout)

      assert length(messages) == total_changes,
             "Expected #{total_changes} change messages from sequential mixed transactions, got #{length(messages)}. " <>
               "This indicates sequential mixed transactions may not be properly replicated."
    end
  end

  defp prepare_sequential_mixed_data(transactions) do
    # Generate IDs for all UPDATE and DELETE operations across all transactions
    {pre_insert_data, id_list, next_insert_id} =
      Enum.reduce(transactions, {[], [], 1}, fn {operation, count},
                                                {pre_data, id_list, counter} ->
        case operation do
          :insert ->
            {pre_data, id_list, counter + count}

          :update ->
            new_data = generate_test_data(count, counter)
            new_ids = Enum.map(new_data, fn {id, _value} -> id end)
            {pre_data ++ new_data, id_list ++ [{:update, new_ids}], counter + count}

          :delete ->
            new_data = generate_test_data(count, counter)
            new_ids = Enum.map(new_data, fn {id, _value} -> id end)
            {pre_data ++ new_data, id_list ++ [{:delete, new_ids}], counter + count}
        end
      end)

    {pre_insert_data, id_list, next_insert_id}
  end

  defp execute_sequential_transactions_mixed(db_conn, transactions, id_list, insert_start_id) do
    id_counter = insert_start_id
    id_list_index = 0

    Enum.reduce(transactions, {id_counter, id_list_index}, fn {operation, count},
                                                              {counter, list_idx} ->
      Postgrex.transaction(db_conn, fn conn ->
        ids_to_use =
          case operation do
            :insert ->
              for i <- 1..count do
                generate_uuid(counter + i - 1)
              end

            :update ->
              {_op, ids} = Enum.at(id_list, list_idx)
              ids

            :delete ->
              {_op, ids} = Enum.at(id_list, list_idx)
              ids
          end

        for {id, idx} <- Enum.with_index(ids_to_use) do
          escaped_id = String.replace(id, "'", "''")

          case operation do
            :insert ->
              value = "seq mixed value #{counter + idx}"
              escaped_value = String.replace(value, "'", "''")

              Postgrex.query!(
                conn,
                "INSERT INTO items VALUES ('#{escaped_id}', '#{escaped_value}')",
                []
              )

            :update ->
              Postgrex.query!(
                conn,
                "UPDATE items SET value = 'updated value' WHERE id = '#{escaped_id}'",
                []
              )

            :delete ->
              Postgrex.query!(conn, "DELETE FROM items WHERE id = '#{escaped_id}'", [])
          end
        end
      end)

      new_counter = if operation == :insert, do: counter + count, else: counter
      new_list_idx = if operation in [:update, :delete], do: list_idx + 1, else: list_idx

      {new_counter, new_list_idx}
    end)
  end
end
