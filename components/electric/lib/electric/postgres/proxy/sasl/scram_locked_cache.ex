defmodule Electric.Postgres.Proxy.SASL.SCRAMLockedCache do
  @moduledoc false
  # Ripped almost entirely, without shame, [from
  # Postgrex](https://github.com/elixir-ecto/postgrex/blob/cd684e7eb25201602c931fab98c9d64e5ae44b2a/lib/postgrex/scram.ex)

  # SCRAM authentication requires expensive calculations
  # that may be repeated across multiple connections.
  # This module provides a cache functionality so that
  # those are done only once, even if concurrently.
  #
  # Since those resources can be created dynamically,
  # multiple times, they are stored in ETS instead of
  # persistent term.
  #
  use GenServer

  @name __MODULE__
  @timeout :infinity

  @doc """
  Reads the cache key.
  """
  def get(key) do
    soft_read(key)
  end

  @doc """
  Reads cache key or executes the given function if not
  cached yet.
  """
  def run(key, fun) do
    try do
      hard_read(key)
    catch
      :error, :badarg ->
        case GenServer.call(@name, {:lock, key}, @timeout) do
          {:uncached, ref} ->
            try do
              fun.()
            catch
              kind, reason ->
                GenServer.cast(@name, {:uncached, ref})
                :erlang.raise(kind, reason, __STACKTRACE__)
            else
              result ->
                write(key, result)
                GenServer.cast(@name, {:cached, ref})
                result
            end

          :cached ->
            hard_read(key)
        end
    end
  end

  defp init(), do: :ets.new(@name, [:public, :set, :named_table, read_concurrency: true])
  defp write(key, value), do: :ets.insert(@name, {key, value})
  defp hard_read(key), do: :ets.lookup_element(@name, key, 2)

  defp soft_read(key) do
    try do
      :ets.lookup_element(@name, key, 2)
    catch
      :error, :badarg -> nil
    end
  end

  ## Callbacks

  @doc false
  def start_link(_opts) do
    GenServer.start_link(__MODULE__, :ok, name: @name)
  end

  @impl true
  def init(:ok) do
    init()
    {:ok, %{keys: %{}, ref_to_key: %{}}}
  end

  @impl true
  def handle_call({:lock, key}, from, state) do
    case state.keys do
      %{^key => {ref, waiting}} ->
        {:noreply, put_in(state.keys[key], {ref, [from | waiting]})}

      %{} ->
        {:noreply, lock(key, from, [], state)}
    end
  end

  @impl true
  def handle_cast({:cached, ref}, state) do
    Process.demonitor(ref, [:flush])
    {key, state} = pop_in(state.ref_to_key[ref])
    {{^ref, waiting}, state} = pop_in(state.keys[key])
    for from <- waiting, do: GenServer.reply(from, :cached)
    {:noreply, state}
  end

  @impl true
  def handle_cast({:uncached, ref}, state) do
    Process.demonitor(ref, [:flush])
    {:noreply, unlock(ref, state)}
  end

  @impl true
  def handle_info({:DOWN, ref, _, _, _}, state) do
    {:noreply, unlock(ref, state)}
  end

  defp lock(key, {pid, _} = from, waiting, state) do
    ref = Process.monitor(pid)
    state = put_in(state.keys[key], {ref, waiting})
    state = put_in(state.ref_to_key[ref], key)
    GenServer.reply(from, {:uncached, ref})
    state
  end

  defp unlock(ref, state) do
    {key, state} = pop_in(state.ref_to_key[ref])
    {{^ref, waiting}, state} = pop_in(state.keys[key])

    case waiting do
      [] -> state
      [from | waiting] -> lock(key, from, waiting, state)
    end
  end
end
