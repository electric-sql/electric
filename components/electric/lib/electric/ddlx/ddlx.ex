defmodule Electric.DDLX do
  @moduledoc """
  Mostly creates SQL for adding DDLX to postgres
  """
  alias Electric.DDLX.Parser
  alias Electric.DDLX.Command

  @spec parse(String.t(), Parser.opts()) :: {:ok, Command.t()} | {:error, Command.Error.t()}
  def parse(statement, opts \\ []) do
    Parser.parse(statement, opts)
  end

  @spec parse!(String.t(), Parser.opts()) :: Command.t() | no_return()
  def parse!(statement, opts \\ []) do
    case parse(statement, opts) do
      {:ok, cmd} -> cmd
      {:error, error} -> raise error
    end
  end

  @doc """
  Turns Electric.DDLX.Commands.Command structs into PostgreSQL
  """
  @spec command_to_postgres(Command.t() | [Command.t()]) :: [String.t()]
  def command_to_postgres(command) do
    Command.pg_sql(command)
  end
end
