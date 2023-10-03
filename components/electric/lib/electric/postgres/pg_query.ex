defmodule Electric.Postgres.PgQuery do
  @moduledoc """
  Introspects the PgQuery application to get a list of protocol buf structs and
  uses it to construct a valid wrapper type.
  """
  # build type specification from list of modules
  m_t = fn m -> quote(do: %unquote(m){}) end

  typespec = fn
    [m], _ ->
      m_t.(m)

    [m | rest], f ->
      {:|, [], [m_t.(m), f.(rest, f)]}
  end

  {:ok, modules} = :application.get_key(:pg_query_ex, :modules)
  modules = Enum.reject(modules, &(&1 in [PgQuery, PgQuery.Parser]))

  @type t() :: unquote(typespec.(modules, typespec))
end
