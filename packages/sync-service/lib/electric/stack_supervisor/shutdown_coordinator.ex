defmodule Electric.StackSupervisor.ShutdownCoordinator do
  @moduledoc """
  Writes a "clean shutdown" marker to `persistent_kv` when the stack
  shuts down gracefully. On the next stack startup, `ShapeStatusOwner`
  reads the marker: if it's missing the stack didn't shut down cleanly
  and all shape data is dropped, because there's no way to know which
  shapes' on-disk state is consistent with which other shapes'
  (different shapes' writers flush independently and can land at
  different `last_persisted_txn_offset`s after a crash).

  This GenServer is added as the *last* child of `StackSupervisor` so
  that on graceful shutdown it terminates *first* (Supervisor stops
  children in reverse start order). Its `terminate/2` runs while every
  other stack process is still alive, then writes the marker.

  If the process is brutal-killed (e.g. `kill -9`, OOM, supervisor
  shutdown timeout exceeded), `terminate/2` does not run, the marker
  is not written, and the next startup correctly treats the previous
  shutdown as dirty.
  """

  use GenServer

  alias Electric.PersistentKV
  alias Electric.Postgres.ReplicationClient
  alias Electric.Replication.ShapeLogCollector

  require Logger

  @marker_key "stack_supervisor:clean_shutdown_marker"
  @drain_timeout 30_000

  def child_spec(opts) do
    %{
      id: __MODULE__,
      start: {__MODULE__, :start_link, [opts]},
      shutdown: 5_000
    }
  end

  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts, name: name(opts[:stack_id]))
  end

  def name(stack_id) when is_binary(stack_id) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__)
  end

  @doc """
  Returns true iff the previous stack shutdown wrote the clean-shutdown
  marker. Has the side effect of clearing the marker — every startup
  must observe it as missing unless the *previous* shutdown wrote it.
  """
  @spec consume_clean_shutdown_marker(Electric.PersistentKV.t()) :: boolean()
  def consume_clean_shutdown_marker(persistent_kv) do
    case PersistentKV.get(persistent_kv, @marker_key) do
      {:ok, _value} ->
        :ok = PersistentKV.set(persistent_kv, @marker_key, nil)
        true

      {:error, :not_found} ->
        false
    end
  end

  @impl true
  def init(opts) do
    Process.flag(:trap_exit, true)

    state = %{
      stack_id: Keyword.fetch!(opts, :stack_id),
      persistent_kv: Keyword.fetch!(opts, :persistent_kv)
    }

    Logger.metadata(stack_id: state.stack_id)
    Process.set_label({:shutdown_coordinator, state.stack_id})

    {:ok, state}
  end

  @impl true
  def terminate(reason, state) do
    if clean_reason?(reason) do
      drain_and_mark_clean(state)
    else
      Logger.warning(
        "ShutdownCoordinator terminating with non-clean reason #{inspect(reason)}; " <>
          "clean-shutdown marker NOT written, next startup will reset shape data"
      )
    end

    :ok
  end

  defp clean_reason?(:shutdown), do: true
  defp clean_reason?({:shutdown, _}), do: true
  defp clean_reason?(:normal), do: true
  defp clean_reason?(_), do: false

  # Run the drain protocol while every other stack process is still alive
  # (we're the last child, so we terminate first):
  # 1. Stop the replication client so no new events arrive at the SLC.
  # 2. Tell the SLC to drain — it stops accepting events and replies once
  #    every consumer has flushed up to the last seen offset.
  # 3. Only then write the clean-shutdown marker. If any step fails, leave
  #    the marker absent so the next startup treats this as dirty.
  defp drain_and_mark_clean(state) do
    with :ok <- stop_replication_client(state.stack_id),
         :ok <- ShapeLogCollector.drain(state.stack_id, @drain_timeout) do
      :ok = PersistentKV.set(state.persistent_kv, @marker_key, true)
      Logger.notice("Stack #{state.stack_id} cleanly shut down")
    else
      error ->
        Logger.warning(
          "Stack #{state.stack_id} failed to drain cleanly (#{inspect(error)}); " <>
            "next startup will reset shape data"
        )
    end
  end

  defp stop_replication_client(stack_id) do
    case GenServer.whereis(ReplicationClient.name(stack_id)) do
      nil ->
        :ok

      pid ->
        try do
          ReplicationClient.stop(pid, :shutdown)
          :ok
        catch
          :exit, _ -> :ok
        end
    end
  end
end
