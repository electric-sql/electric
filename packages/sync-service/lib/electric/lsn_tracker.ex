defmodule Electric.LsnTracker do
  alias Electric.Postgres.Lsn
  import Electric, only: [is_stack_id: 1]

  @type stack_ref :: Electric.stack_id() | atom()

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

  @spec get_last_processed_lsn(Electric.stack_id()) :: Lsn.t()
  def get_last_processed_lsn(stack_id) do
    [last_processed_lsn: lsn] =
      stack_id
      |> table()
      |> :ets.lookup(:last_processed_lsn)

    lsn
  end

  @doc """
  Returns the ETS table name used to store LSN info for the given stack ID.
  """
  @spec stack_ref(Electric.stack_id()) :: atom()
  def stack_ref(stack_id) when is_stack_id(stack_id), do: table(stack_id)

  defp table(stack_ref) when is_stack_id(stack_ref), do: :"#{inspect(__MODULE__)}:#{stack_ref}"
  defp table(stack_ref) when is_atom(stack_ref), do: stack_ref
end
