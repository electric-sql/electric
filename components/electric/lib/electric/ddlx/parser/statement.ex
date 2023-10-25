defmodule Electric.DDLX.Parser.Statement do
  defstruct [:stmt, :tokens, :cmd]

  def command(%__MODULE__{} = stmt) do
    stmt.cmd
  end
end
