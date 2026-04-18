defmodule Electric.LsnTracker do
  alias Electric.Postgres.Lsn
  import Electric, only: [is_stack_id: 1]

  @type stack_ref :: Electric.stack_id() | atom()
  @global_lsn_updates_topic :global_lsn_updates

  # this function is idempotent to avoid problems in tests
  @spec initialize(stack_ref()) :: :ok
  def initialize(stack_ref) do
    table = table(stack_ref)

    case :ets.info(table, :id) do
      :undefined ->
        :ets.new(table, [:public, :named_table])
        :ok

      ref when is_reference(ref) ->
        :ok
    end
  end

  @spec set_last_processed_lsn(stack_ref(), Lsn.t() | non_neg_integer()) :: :ok
  def set_last_processed_lsn(stack_ref, lsn) when is_struct(lsn, Lsn) do
    stack_ref
    |> table()
    |> :ets.insert({:last_processed_lsn, lsn})

    :ok
  end

  def set_last_processed_lsn(stack_ref, lsn) when is_integer(lsn) do
    set_last_processed_lsn(stack_ref, Lsn.from_integer(lsn))
  end

  @spec initialize_last_processed_lsn(stack_ref(), Lsn.t()) :: :ok
  def initialize_last_processed_lsn(stack_ref, lsn) when is_struct(lsn, Lsn) do
    stack_ref
    |> table()
    |> :ets.insert_new({:last_processed_lsn, lsn})

    :ok
  end

  def initialize_last_processed_lsn(stack_ref, lsn) when is_integer(lsn) do
    initialize_last_processed_lsn(stack_ref, Lsn.from_integer(lsn))
  end

  @spec get_last_processed_lsn(stack_ref()) :: Lsn.t() | nil
  def get_last_processed_lsn(stack_ref) do
    case stack_ref |> table() |> :ets.lookup(:last_processed_lsn) do
      [{:last_processed_lsn, lsn}] -> lsn
      [] -> nil
    end
  end

  @spec broadcast_last_seen_lsn(stack_ref(), Lsn.t() | non_neg_integer()) :: :ok
  def broadcast_last_seen_lsn(stack_ref, lsn) when is_struct(lsn, Lsn) do
    broadcast_last_seen_lsn(stack_ref, Lsn.to_integer(lsn))
  end

  def broadcast_last_seen_lsn(stack_ref, lsn) when is_integer(lsn) do
    # Store the broadcast LSN so newly subscribing consumers can read the
    # current value without waiting for the next broadcast.
    try do
      stack_ref |> table() |> :ets.insert({:last_broadcast_lsn, lsn})
    rescue
      ArgumentError -> :ok
    end

    registry = Electric.StackSupervisor.registry_name(stack_ref)

    if Process.whereis(registry) do
      Registry.dispatch(registry, @global_lsn_updates_topic, fn entries ->
        for {pid, _} <- entries, do: send(pid, {:global_last_seen_lsn, lsn})
      end)
    end

    :ok
  end

  @doc """
  Returns the most recently broadcast LSN, or 0 if none has been broadcast yet.
  """
  @spec get_last_broadcast_lsn(stack_ref()) :: non_neg_integer()
  def get_last_broadcast_lsn(stack_ref) do
    case :ets.lookup(table(stack_ref), :last_broadcast_lsn) do
      [{:last_broadcast_lsn, lsn}] -> lsn
      [] -> 0
    end
  rescue
    ArgumentError -> 0
  end

  @spec subscribe_to_global_lsn_updates(stack_ref(), term()) :: {:ok, pid()} | {:error, term()}
  def subscribe_to_global_lsn_updates(stack_ref, value \\ []) do
    with {:ok, _} <-
           Registry.register(
             Electric.StackSupervisor.registry_name(stack_ref),
             @global_lsn_updates_topic,
             value
           ) do
      last_lsn = get_last_broadcast_lsn(stack_ref)

      if last_lsn > 0 do
        send(self(), {:global_last_seen_lsn, last_lsn})
      end

      {:ok, self()}
    end
  end

  @spec unsubscribe_from_global_lsn_updates(stack_ref()) :: :ok
  def unsubscribe_from_global_lsn_updates(stack_ref) do
    Registry.unregister(
      Electric.StackSupervisor.registry_name(stack_ref),
      @global_lsn_updates_topic
    )
  end

  @doc """
  Returns the ETS table name used to store LSN info for the given stack ID.
  """
  @spec stack_ref(Electric.stack_id()) :: atom()
  def stack_ref(stack_id) when is_stack_id(stack_id), do: table(stack_id)

  defp table(stack_ref) when is_stack_id(stack_ref), do: :"#{inspect(__MODULE__)}:#{stack_ref}"
  defp table(stack_ref) when is_atom(stack_ref), do: stack_ref
end
