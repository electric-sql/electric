defprotocol Electric.DDLX.Command do
  @spec pg_sql(t()) :: [String.t()]
  def pg_sql(command)

  @spec table_name(t()) :: String.t()
  def table_name(command)

  @spec tag(t()) :: String.t()
  def tag(command)
end

defimpl Electric.DDLX.Command, for: List do
  def pg_sql(commands) do
    Enum.flat_map(commands, &Electric.DDLX.Command.pg_sql/1)
  end

  def table_name([cmd]) do
    Electric.DDLX.Command.table_name(cmd)
  end

  def tag([cmd | _commands]) do
    Electric.DDLX.Command.tag(cmd)
  end
end
