defmodule Electric.Postgres.Extension.Functions do
  @moduledoc """
  This module organizes SQL functions that are to be defined in Electric's internal database schema.
  """

  alias Electric.Postgres.Extension
  require EEx

  sql_files =
    "functions/*.sql.eex"
    |> Path.expand(__DIR__)
    |> Path.wildcard()

  function_names =
    for path <- sql_files do
      @external_resource path

      name = path |> Path.basename(".sql.eex") |> String.to_atom()
      _ = EEx.function_from_file(:def, name, path, [:assigns])

      name
    end

  fn_name_type =
    Enum.reduce(function_names, fn name, code ->
      quote do
        unquote(name) | unquote(code)
      end
    end)

  @typep name :: unquote(fn_name_type)
  @typep sql :: String.t()
  @type function_list :: [{name, sql}]

  @function_names function_names

  @doc """
  Get a list of `{name, SQL}` pairs where the the SQL code contains the definition of a function (or multiple functions).

  Every function in the list is defined as `CREATE OR REPLACE FUNCTION`.
  """
  # NOTE(alco): Eventually, we're hoping to move all function definitions out of migrations and define them all
  # here. See VAX-1016 for details.
  @spec list :: function_list
  def list do
    for name <- @function_names do
      {name, by_name(name)}
    end
  end

  @doc """
  Look up the SQL code for a function by its canonical name (basename without extension).

  We catalog all function definitions as files inside the `functions/` subdirectory. A single file usually contains a
  single function definition but may have more than one if they are all meant to be evaluated as a unit.
  """
  @spec by_name(name) :: sql
  def by_name(name) when name in @function_names do
    apply(__MODULE__, name, [assigns()])
  end

  # This map of assigns is the same for all function templates.
  defp assigns do
    %{
      schema: Extension.schema(),
      ddl_table: Extension.ddl_table(),
      txid_type: Extension.txid_type(),
      txts_type: Extension.txts_type(),
      version_table: Extension.version_table(),
      electrified_tracking_table: Extension.electrified_tracking_table(),
      publication_name: Extension.publication_name()
    }
  end
end
