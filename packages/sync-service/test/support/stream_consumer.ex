defmodule Support.StreamConsumer do
  @moduledoc """
  Test helper for consuming Electric.Client streams in integration tests.
  """

  alias Electric.Client.Message.ChangeMessage
  alias Electric.Client.Message.ControlMessage
  alias Electric.Client.Message.ResumeMessage

  import ExUnit.Assertions

  @default_timeout 5_000

  defstruct [:task, :task_pid, :timeout]

  @doc """
  Start consuming a stream, forwarding messages to the test process.

  ## Options

    * `:timeout` - default timeout for assertions (default: 5000ms)
  """
  def start(stream, opts \\ []) do
    test_pid = self()
    timeout = Keyword.get(opts, :timeout, @default_timeout)

    # Start the streaming task
    task =
      Task.async(fn ->
        stream
        |> Stream.each(fn msg ->
          send(test_pid, {:stream_message, self(), msg})
        end)
        |> Stream.run()
      end)

    {:ok,
     %__MODULE__{
       task: task,
       task_pid: task.pid,
       timeout: timeout
     }}
  end

  @doc """
  Stop the consumer and cleanup resources.
  """
  def stop(%__MODULE__{task: task}) do
    Task.shutdown(task, :brutal_kill)
    :ok
  end

  @doc """
  Assert an insert message is received with matching value fields.
  """
  def assert_insert(%__MODULE__{} = consumer, value_pattern, timeout \\ nil) do
    timeout = timeout || consumer.timeout

    assert_receive_message(
      consumer,
      fn
        %ChangeMessage{headers: %{operation: :insert}, value: value} ->
          pattern_matches?(value, value_pattern)

        _ ->
          false
      end,
      timeout
    )
  end

  @doc """
  Assert an update message is received with matching value fields.
  Optionally match old_value (only present in :full replica mode).
  """
  def assert_update(
        %__MODULE__{} = consumer,
        value_pattern,
        old_value_pattern \\ nil,
        timeout \\ nil
      ) do
    timeout = timeout || consumer.timeout

    assert_receive_message(
      consumer,
      fn
        %ChangeMessage{headers: %{operation: :update}, value: value, old_value: old_value} ->
          value_matches = pattern_matches?(value, value_pattern)

          old_value_matches =
            old_value_pattern == nil or pattern_matches?(old_value || %{}, old_value_pattern)

          value_matches and old_value_matches

        _ ->
          false
      end,
      timeout
    )
  end

  @doc """
  Assert a delete message is received with matching value fields.
  """
  def assert_delete(%__MODULE__{} = consumer, value_pattern, timeout \\ nil) do
    timeout = timeout || consumer.timeout

    assert_receive_message(
      consumer,
      fn
        %ChangeMessage{headers: %{operation: :delete}, value: value} ->
          pattern_matches?(value, value_pattern)

        _ ->
          false
      end,
      timeout
    )
  end

  @doc """
  Assert an up_to_date control message is received.
  """
  def assert_up_to_date(%__MODULE__{} = consumer, timeout \\ nil) do
    timeout = timeout || consumer.timeout

    assert_receive_message(
      consumer,
      fn
        %ControlMessage{control: :up_to_date} -> true
        _ -> false
      end,
      timeout
    )
  end

  @doc """
  Assert a resume message is received (skips non-matching messages).
  """
  def assert_resume(%__MODULE__{} = consumer, timeout \\ nil) do
    timeout = timeout || consumer.timeout
    assert_receive_matching(consumer, &match?(%ResumeMessage{}, &1), timeout)
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

  defp do_await_count(
         %{task_pid: task_pid} = consumer,
         count,
         matcher,
         collected,
         timeout,
         start_time
       ) do
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
          flunk("Received unexpected message: #{inspect(msg)}")
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

  defp assert_receive_matching(%__MODULE__{task_pid: task_pid}, matcher, timeout) do
    do_assert_receive_matching(task_pid, matcher, timeout, System.monotonic_time(:millisecond))
  end

  defp do_assert_receive_matching(task_pid, matcher, timeout, start_time) do
    elapsed = System.monotonic_time(:millisecond) - start_time
    remaining = max(0, timeout - elapsed)

    receive do
      {:stream_message, ^task_pid, msg} ->
        if matcher.(msg) do
          msg
        else
          # Skip non-matching messages and keep waiting
          do_assert_receive_matching(task_pid, matcher, timeout, start_time)
        end
    after
      remaining ->
        flunk("Expected to receive matching message within #{timeout}ms")
    end
  end

  @doc """
  Collect all messages received within the timeout period.
  Returns a list of messages (possibly empty).

  ## Options

    * `:timeout` - how long to wait for messages (default: 100ms)
    * `:match` - optional function to filter messages
  """
  def collect_messages(%__MODULE__{task_pid: task_pid}, opts \\ []) do
    timeout = Keyword.get(opts, :timeout, 100)
    matcher = Keyword.get(opts, :match, fn _ -> true end)

    do_collect_messages(task_pid, matcher, [], timeout, System.monotonic_time(:millisecond))
  end

  defp do_collect_messages(task_pid, matcher, collected, timeout, start_time) do
    elapsed = System.monotonic_time(:millisecond) - start_time
    remaining = max(0, timeout - elapsed)

    receive do
      {:stream_message, ^task_pid, msg} ->
        if matcher.(msg) do
          do_collect_messages(task_pid, matcher, [msg | collected], timeout, start_time)
        else
          do_collect_messages(task_pid, matcher, collected, timeout, start_time)
        end
    after
      remaining -> Enum.reverse(collected)
    end
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
