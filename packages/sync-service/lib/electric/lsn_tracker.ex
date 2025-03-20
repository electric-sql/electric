defmodule Electric.LsnTracker do
  alias Electric.Postgres.Lsn

  def init(stack_id) do
    stack_id
    |> table()
    |> :ets.new([:public, :named_table])
  end

  @spec set_last_processed_lsn(Lsn.t(), String.t()) :: :ok
  def set_last_processed_lsn(lsn, stack_id) when is_struct(lsn, Lsn) do
    stack_id
    |> table()
    |> :ets.insert({:last_processed_lsn, lsn})
  end

  @spec get_last_processed_lsn(String.t()) :: Lsn.t()
  def get_last_processed_lsn(stack_id) do
    [last_processed_lsn: lsn] =
      stack_id
      |> table()
      |> :ets.lookup(:last_processed_lsn)

    lsn
  end

  def reset(stack_id) do
    set_last_processed_lsn(Lsn.from_integer(0), stack_id)
  end

  defp table(stack_id) do
    :"#{stack_id}:lsn_tracker"
  end
end
