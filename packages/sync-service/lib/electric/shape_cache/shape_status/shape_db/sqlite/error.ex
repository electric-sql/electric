defmodule Electric.ShapeCache.ShapeStatus.ShapeDb.Sqlite.Error do
  defexception [:message]

  @impl true
  def exception(args) do
    action = Keyword.get(args, :action, :read)
    {:ok, error} = Keyword.fetch(args, :error)
    %__MODULE__{message: "ShapeDb.Sqlite #{action} failed: #{inspect(error)}"}
  end
end
