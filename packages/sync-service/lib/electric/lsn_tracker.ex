defmodule Electric.LsnTracker do
  alias Electric.Postgres.Lsn

  # this function is idempotent to avoid problems in tests
  @spec initialize(Electric.stack_id()) :: :ok
  def initialize(stack_id) do
    table = table(stack_id)

    case :ets.info(table, :id) do
      :undefined ->
        :ets.new(table, [:public, :named_table])
        :ok

      ref when is_reference(ref) ->
        :ok
    end
  end

  @spec set_last_processed_lsn(Lsn.t() | non_neg_integer(), Electric.stack_id()) :: :ok
  def set_last_processed_lsn(lsn, stack_id) when is_struct(lsn, Lsn) do
    stack_id
    |> table()
    |> :ets.insert({:last_processed_lsn, lsn})

    :ok
  end

  def set_last_processed_lsn(lsn, stack_id) when is_integer(lsn) do
    set_last_processed_lsn(Lsn.from_integer(lsn), stack_id)
  end

  @spec initialize_last_processed_lsn(Lsn.t(), Electric.stack_id()) :: :ok
  def initialize_last_processed_lsn(lsn, stack_id) when is_struct(lsn, Lsn) do
    stack_id
    |> table()
    |> :ets.insert_new({:last_processed_lsn, lsn})

    :ok
  end

  def initialize_last_processed_lsn(lsn, stack_id) when is_integer(lsn) do
    initialize_last_processed_lsn(Lsn.from_integer(lsn), stack_id)
  end

  @spec get_last_processed_lsn(Electric.stack_id()) :: Lsn.t()
  def get_last_processed_lsn(stack_id) do
    [last_processed_lsn: lsn] =
      stack_id
      |> table()
      |> :ets.lookup(:last_processed_lsn)

    lsn
  end

  defp table(stack_id) do
    :"#{inspect(__MODULE__)}:#{stack_id}"
  end
end
