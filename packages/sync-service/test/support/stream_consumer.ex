defmodule Support.StreamConsumer do
  @moduledoc """
  Test helper for consuming Electric.Client streams in integration tests.
  """

  alias Electric.Client.Message.ChangeMessage
  alias Electric.Client.Message.ControlMessage

  import ExUnit.Assertions

  @default_timeout 5_000

  defstruct [:task, :task_pid, :messages_table, :timeout]

  @doc """
  Start consuming a stream, forwarding messages to the test process.

  ## Options

    * `:timeout` - default timeout for assertions (default: 5000ms)
    * `:track_messages` - store messages in ETS for later analysis (default: false)
  """
  def start(stream, opts \\ []) do
    test_pid = self()
    track_messages = Keyword.get(opts, :track_messages, false)
    timeout = Keyword.get(opts, :timeout, @default_timeout)

    # Create ETS table if tracking messages
    messages_table = if track_messages do
      :ets.new(:stream_messages, [:ordered_set, :public])
    end

    # Start the streaming task
    task = Task.async(fn ->
      stream
      |> Stream.each(fn msg ->
        # Track message if enabled
        if messages_table do
          :ets.insert(messages_table, {System.monotonic_time(), msg})
        end
        # Send to test process
        send(test_pid, {:stream_message, self(), msg})
      end)
      |> Stream.run()
    end)

    {:ok, %__MODULE__{
      task: task,
      task_pid: task.pid,
      messages_table: messages_table,
      timeout: timeout
    }}
  end

  @doc """
  Stop the consumer and cleanup resources.
  """
  def stop(%__MODULE__{task: task, messages_table: table}) do
    Task.shutdown(task, :brutal_kill)
    if table, do: :ets.delete(table)
    :ok
  end

  @doc """
  Assert an insert message is received with matching value fields.
  """
  def assert_insert(%__MODULE__{} = consumer, value_pattern, timeout \\ nil) do
    timeout = timeout || consumer.timeout
    assert_receive_message(consumer, fn
      %ChangeMessage{headers: %{operation: :insert}, value: value} ->
        pattern_matches?(value, value_pattern)
      _ ->
        false
    end, timeout)
  end

  @doc """
  Assert an update message is received with matching value fields.
  Optionally match old_value (only present in :full replica mode).
  """
  def assert_update(%__MODULE__{} = consumer, value_pattern, old_value_pattern \\ nil, timeout \\ nil) do
    timeout = timeout || consumer.timeout
    assert_receive_message(consumer, fn
      %ChangeMessage{headers: %{operation: :update}, value: value, old_value: old_value} ->
        value_matches = pattern_matches?(value, value_pattern)
        old_value_matches = old_value_pattern == nil or pattern_matches?(old_value || %{}, old_value_pattern)
        value_matches and old_value_matches
      _ ->
        false
    end, timeout)
  end

  @doc """
  Assert a delete message is received with matching value fields.
  """
  def assert_delete(%__MODULE__{} = consumer, value_pattern, timeout \\ nil) do
    timeout = timeout || consumer.timeout
    assert_receive_message(consumer, fn
      %ChangeMessage{headers: %{operation: :delete}, value: value} ->
        pattern_matches?(value, value_pattern)
      _ ->
        false
    end, timeout)
  end

  @doc """
  Assert an up_to_date control message is received.
  """
  def assert_up_to_date(%__MODULE__{} = consumer, timeout \\ nil) do
    timeout = timeout || consumer.timeout
    assert_receive_message(consumer, fn
      %ControlMessage{control: :up_to_date} -> true
      _ -> false
    end, timeout)
  end

  @doc """
  Assert a move_out control message is received.
  """
  def assert_move_out(%__MODULE__{} = consumer, timeout \\ nil) do
    timeout = timeout || consumer.timeout
    assert_receive_message(consumer, fn
      %ControlMessage{control: :move_out} -> true
      _ -> false
    end, timeout)
  end

  @doc """
  Wait for N messages matching a condition.

  ## Options

    * `:match` - function to filter messages (default: matches all)
    * `:timeout` - timeout in ms (default: consumer timeout)
  """
  def await_count(%__MODULE__{} = consumer, count, opts \\ []) do
    matcher = Keyword.get(opts, :match, fn _ -> true end)
    timeout = Keyword.get(opts, :timeout, consumer.timeout)

    do_await_count(consumer, count, matcher, [], timeout, System.monotonic_time(:millisecond))
  end

  defp do_await_count(_consumer, 0, _matcher, collected, _timeout, _start) do
    {:ok, Enum.reverse(collected)}
  end

  defp do_await_count(%{task_pid: task_pid} = consumer, count, matcher, collected, timeout, start_time) do
    elapsed = System.monotonic_time(:millisecond) - start_time
    remaining = max(0, timeout - elapsed)

    receive do
      {:stream_message, ^task_pid, msg} ->
        if matcher.(msg) do
          do_await_count(consumer, count - 1, matcher, [msg | collected], timeout, start_time)
        else
          do_await_count(consumer, count, matcher, collected, timeout, start_time)
        end
    after
      remaining -> {:error, :timeout}
    end
  end

  @doc """
  Get all collected messages (requires track_messages: true).

  ## Options

    * `:operation` - filter by operation type (:insert, :update, :delete)
  """
  def collected_messages(consumer, opts \\ [])

  def collected_messages(%__MODULE__{messages_table: nil}, _opts) do
    raise "Message tracking not enabled. Start consumer with track_messages: true"
  end

  def collected_messages(%__MODULE__{messages_table: table}, opts) do
    operation_filter = Keyword.get(opts, :operation)

    table
    |> :ets.tab2list()
    |> Enum.map(fn {_ts, msg} -> msg end)
    |> maybe_filter_operation(operation_filter)
  end

  defp maybe_filter_operation(messages, nil), do: messages
  defp maybe_filter_operation(messages, operation) do
    Enum.filter(messages, fn
      %ChangeMessage{headers: %{operation: ^operation}} -> true
      _ -> false
    end)
  end

  @doc """
  Assert that insert comes before delete for a given row ID.
  Requires track_messages: true.
  """
  def assert_insert_before_delete(%__MODULE__{} = consumer, row_id) do
    messages = collected_messages(consumer)
    |> Enum.filter(&match?(%ChangeMessage{}, &1))

    insert_idx = Enum.find_index(messages, fn msg ->
      msg.headers.operation == :insert and msg.value["id"] == row_id
    end)

    delete_idx = Enum.find_index(messages, fn msg ->
      msg.headers.operation == :delete and msg.value["id"] == row_id
    end)

    assert insert_idx != nil, "No insert found for row #{row_id}"
    assert delete_idx != nil, "No delete found for row #{row_id}"
    assert insert_idx < delete_idx, "Insert should come before delete for row #{row_id}"

    :ok
  end

  # Private helpers

  defp assert_receive_message(%__MODULE__{task_pid: task_pid}, matcher, timeout) do
    do_assert_receive_message(task_pid, matcher, timeout, System.monotonic_time(:millisecond))
  end

  defp do_assert_receive_message(task_pid, matcher, timeout, start_time) do
    elapsed = System.monotonic_time(:millisecond) - start_time
    remaining = max(0, timeout - elapsed)

    receive do
      {:stream_message, ^task_pid, msg} ->
        if matcher.(msg) do
          msg
        else
          do_assert_receive_message(task_pid, matcher, timeout, start_time)
        end
    after
      remaining ->
        flunk("Expected to receive matching message within #{timeout}ms")
    end
  end

  defp pattern_matches?(map, pattern) when is_map(map) and is_map(pattern) do
    Enum.all?(pattern, fn {key, expected} ->
      case Map.fetch(map, key) do
        {:ok, actual} when is_map(expected) and is_map(actual) ->
          pattern_matches?(actual, expected)
        {:ok, actual} ->
          actual == expected
        :error ->
          false
      end
    end)
  end

  @doc """
  Macro for cleaner test blocks - auto start/stop.

  ## Example

      import Support.StreamConsumer

      stream = Client.stream(client, "items", live: true)

      with_consumer stream do
        assert_insert(consumer, %{"id" => "123"})
        assert_up_to_date(consumer)
      end
  """
  defmacro with_consumer(stream, opts \\ [], do: block) do
    quote do
      {:ok, var!(consumer)} = Support.StreamConsumer.start(unquote(stream), unquote(opts))

      try do
        unquote(block)
      after
        Support.StreamConsumer.stop(var!(consumer))
      end
    end
  end
end
