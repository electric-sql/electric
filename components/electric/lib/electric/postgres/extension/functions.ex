defmodule Electric.Postgres.Extension.Functions do
  require EEx

  sql_files =
    "functions/*.sql.eex"
    |> Path.expand(__DIR__)
    |> Path.wildcard()

  for path <- sql_files, do: @external_resource(path)

  @function_defs Map.new(sql_files, fn path ->
                   {Path.basename(path, ".sql.eex"), {Path.basename(path), File.read!(path)}}
                 end)

  @doc """
  Get a list of SQL statements that create various internal SQL functions in the `electric` schema.

  Every function in the list is defined as `CREATE OR REPLACE FUNCTION`.
  """
  def list do
    for {name, args} <- [{"validate_table_column_types", []}] do
      {filename, sql} = @function_defs[name]
      {name, EEx.eval_string(sql, args, file: filename)}
    end
  end
end
