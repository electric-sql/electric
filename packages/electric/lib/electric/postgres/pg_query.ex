defmodule Electric.Postgres.PgQuery do
  @moduledoc false

  # Introspects the PgQuery application to get a list of protocol buf structs and
  # uses it to construct a valid wrapper type.
  # build type specification from list of modules

  [module | modules] =
    Application.spec(:pg_query_ex, :modules)
    |> List.delete(PgQuery)
    |> List.delete(PgQuery.Parser)

  pg_query_structs_type =
    Enum.reduce(modules, quote(do: %unquote(module){}), fn name, acc ->
      quote do
        %unquote(name){} | unquote(acc)
      end
    end)

  @type t :: unquote(pg_query_structs_type)
end
