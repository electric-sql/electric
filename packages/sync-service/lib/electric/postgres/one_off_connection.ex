defmodule Electric.Postgres.OneOffConnection do
  @moduledoc """
  A wrapper around Postgrex.SimpleConnection that provides synchronous API for querying the
  database.
  """

  @behaviour Postgrex.SimpleConnection

  @default_timeout 5000

  @doc """
  Attempt a database connection using the given connection options.

  This function is useful to verify that a database connection can be established using the
  provided connection options. Once a connection has been established, the connection process
  shuts down synchronously before this function returns.
  """
  @spec attempt_connection(keyword()) :: :success | {:error, Postgrex.Error.t()}
  def attempt_connection(kwopts) do
    connect_and_maybe_query(kwopts, &handle_connection/1)
  end

  @doc """
  Open a one-off database connection and execute a simple query.

  Once a connection has been established, the query is executed, the connection process shuts
  down and the query result is returned from the function.
  """
  @spec query(String.t(), keyword()) ::
          {:ok, Postgrex.Result.t()} | {:error, Postgrex.Error.t() | :timeout}
  def query(query, kwopts) do
    timeout = Keyword.get(kwopts, :timeout, @default_timeout)
    connect_and_maybe_query([query: query] ++ kwopts, &handle_query_result(&1, timeout))
  end

  ###

  defp connect_and_maybe_query(kwopts, on_connected_callback_fn) do
    {connection_opts, kwopts} = Keyword.pop(kwopts, :connection_opts)

    connection_opts =
      connection_opts
      |> Electric.Utils.deobfuscate_password()
      |> Keyword.merge(auto_reconnect: false, sync_connect: true)

    trap_exit_val = Process.flag(:trap_exit, true)

    result =
      with {:ok, pid} <-
             Postgrex.SimpleConnection.start_link(
               __MODULE__,
               [parent_pid: self()] ++ kwopts,
               connection_opts
             ) do
        on_connected_callback_fn.(pid)
      end

    Process.flag(:trap_exit, trap_exit_val)

    result
  end

  # Callback executed after Postgrex.SimpleConnection has successfully connected and there's no query to run.
  defp handle_connection(pid) do
    exit_connection_process(pid)
    :success
  end

  # Callback executed after Postgrex.SimpleConnection has successfully connected and sent off a query to the database.
  defp handle_query_result(pid, timeout) do
    mon = Process.monitor(pid)

    result =
      receive do
        {^pid, %Postgrex.Result{} = result} -> {:ok, result}
        {^pid, %Postgrex.Error{} = error} -> {:error, error}
        {:DOWN, ^mon, :process, ^pid, reason} -> {:error, reason}
      after
        timeout -> {:error, :timeout}
      end

    Process.demonitor(mon, [:flush])
    exit_connection_process(pid)

    result
  end

  defp exit_connection_process(pid) do
    Process.exit(pid, :shutdown)

    receive do
      {:EXIT, ^pid, _reason} -> :ok
    end
  end

  ###

  @impl true
  def init(kwopts) do
    config =
      kwopts
      |> Map.new()

    %{stack_id: stack_id} = config

    Process.set_label({config.label, stack_id})
    Logger.metadata(stack_id: stack_id, is_connection_process?: true)
    Electric.Telemetry.Sentry.set_tags_context(stack_id: stack_id)

    {:ok, config}
  end

  @impl true
  def handle_connect(state) do
    if query = state[:query] do
      {:query, query, state}
    else
      {:noreply, state}
    end
  end

  @impl true
  def handle_result([%Postgrex.Result{} = result], state) do
    send(state.parent_pid, {self(), result})
    {:noreply, state}
  end

  def handle_result(%Postgrex.Error{} = error, state) do
    send(state.parent_pid, {self(), error})
    {:noreply, state}
  end

  @impl true
  def notify(_channel, _payload, _state) do
    :ok
  end
end
