defmodule Electric.Postgres.OneOffConnection do
  require Logger

  @behaviour Postgrex.SimpleConnection

  @default_timeout 5000

  def query(query, kwopts) do
    {connection_opts, kwopts} = Keyword.pop(kwopts, :connection_opts)
    {timeout, kwopts} = Keyword.pop(kwopts, :timeout, @default_timeout)

    connection_opts =
      connection_opts
      |> Electric.Utils.deobfuscate_password()
      |> Keyword.merge(auto_reconnect: false, sync_connect: true)

    old_flag = Process.flag(:trap_exit, true)

    {:ok, pid} =
      Postgrex.SimpleConnection.start_link(
        __MODULE__,
        [query: query, parent_pid: self()] ++ kwopts,
        connection_opts
      )

    mon = Process.monitor(pid)

    result =
      receive do
        {^pid, %Postgrex.Result{} = result} -> {:ok, result}
        {^pid, %Postgrex.Error{} = error} -> {:error, error}
        {:DOWN, ^mon, :process, ^pid, reason} -> {:error, reason}
      after
        timeout -> {:error, :timeout}
      end

    Process.exit(pid, :shutdown)
    Process.demonitor(mon, [:flush])

    receive do
      {:EXIT, ^pid, reason} -> Logger.debug("OneOffConnection exited: #{inspect(reason)}")
    end

    Process.flag(:trap_exit, old_flag)

    result
  end

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
    {:query, state.query, state}
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
