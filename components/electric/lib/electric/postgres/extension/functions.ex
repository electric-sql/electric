defmodule Electric.Postgres.Extension.Functions do
  @moduledoc """
  This module organizes SQL functions that are to be defined in Electric's internal database schema.
  """

  # Import all functions from the Extension module to make them available for calling inside SQL function templates when
  # those templates are being evaludated by EEx.
  import Electric.Postgres.Extension, warn: false

  require EEx

  @template_dir "priv/sql_function_templates"

  template_dir_path = Application.app_dir(:electric, @template_dir)
  sql_template_paths = Path.wildcard(template_dir_path <> "/**/*.sql.eex")

  function_paths =
    for path <- sql_template_paths do
      relpath = Path.relative_to(path, template_dir_path)
      name = path |> Path.basename(".sql.eex") |> String.to_atom()
      {relpath, name}
    end

  function_names = for {_relpath, name} <- function_paths, do: name

  fn_name_type =
    Enum.reduce(function_names, fn name, code ->
      quote do
        unquote(name) | unquote(code)
      end
    end)

  @typep name :: unquote(fn_name_type)
  @typep sql :: binary
  @type function_list :: [{Path.t(), sql}]

  @function_paths function_paths
  @function_names function_names

  @doc """
  Get a list of `{name, SQL}` pairs where the SQL code contains the definition of a function (or multiple functions).

  Every function in the list is defined as `CREATE OR REPLACE FUNCTION`.
  """
  # NOTE(alco): Eventually, we're hoping to move all function definitions out of migrations and define them all
  # here. See VAX-1016 for details.
  @spec list :: function_list
  def list do
    for {relpath, _name} <- @function_paths do
      {relpath, eval_template(relpath)}
    end
  end

  @doc """
  Look up the SQL code for a function by its canonical name (basename without extension).

  We catalog all function definitions as files inside the `functions/` subdirectory. A single file usually contains a
  single function definition but may have more than one if they are all meant to be evaluated as a unit.
  """
  @spec by_name(name) :: sql
  def by_name(name) when name in @function_names do
    {relpath, ^name} = List.keyfind(@function_paths, name, 1)
    eval_template(relpath)
  end

  defp eval_template(relpath) do
    Path.join(Application.app_dir(:electric, @template_dir), relpath)
    |> EEx.compile_file()
    |> Code.eval_quoted([], __ENV__)
    |> elem(0)
  end
end
