defmodule Electric.DDLX do
  @moduledoc """
  Mostly creates SQL for adding DDLX to postgres
  """
  alias Electric.DDLX.Parse.Parser
  alias Electric.DDLX.Command

  @doc """
  Checks a Postgres statements to see if it is actually DDLX
  """
  @spec is_ddlx(String.t()) :: boolean()
  def is_ddlx(statement) do
    Parser.is_ddlx(statement)
  end

  @doc """
  Turns DDLX statements into Electric.DDLX.Commands.Command structs
  """
  @spec ddlx_to_commands(String.t() | [String.t()]) ::
          {:ok, Command.t()} | {:ok, [Command.t()]} | {:error, String.t()}
  def ddlx_to_commands(statement) do
    if Parser.is_ddlx(statement) do
      Parser.parse(statement)
    else
      {:error, "not recognised"}
    end
  end

  @doc """
  Turns Electric.DDLX.Commands.Command structs into PostgreSQL
  """
  @spec command_to_postgres(Command.t() | [Command.t()]) :: String.t() | [String.t()]
  def command_to_postgres(command) do
    Command.pg_sql(command)
  end
end
