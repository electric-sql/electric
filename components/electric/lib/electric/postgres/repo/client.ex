defmodule Electric.Postgres.Repo.Client do
  @moduledoc """
  Postgres database client that relies on `Electric.Postgres.Repo`.

  Uses the repo to check out connections from the pool and execute queries on them.
  """

  alias Electric.Postgres.Repo
  alias Electric.Replication.Connectors

  @type row :: [term]

  @doc """
  Execute the given function using a pooled DB connection.

  The pool is managed by `Electric.Postgres.Repo` and so the passed function should use the
  repo module's API for querying and executing SQL statements instead of `epgsql`. See
  `pooled_query!/3` and `query!/2` below for a high-level API built on top of the Ecto repo.
  """
  @spec checkout_from_pool(Connectors.origin(), (-> any)) :: any
  def checkout_from_pool(origin, fun) when is_binary(origin) and is_function(fun, 0) do
    Repo.put_dynamic_repo(Repo.name(origin))
    Repo.checkout(fun)
  end

  @doc """
  Execute the given function in a single transaction using a pooled DB connection.

  The pool is managed by `Electric.Postgres.Repo`, see `checkout/2` for more info.
  """
  @spec pooled_transaction(Connectors.origin(), binary() | nil, (-> any)) :: any
  def pooled_transaction(origin, mode \\ nil, fun)
      when is_binary(origin) and is_function(fun, 0) do
    Repo.put_dynamic_repo(Repo.name(origin))

    Repo.transaction(fn ->
      if mode, do: Repo.query!("SET TRANSACTION #{mode}")
      fun.()
    end)
  end

  @doc """
  Execute the given SQL query/statement using a pooled DB connection.

  The pool is managed by `Electric.Postgres.Repo` and the query is executed by invoking `query!/2`.
  """
  @spec pooled_query!(Connectors.origin(), String.t(), [term]) :: {[String.t()], [tuple()]}
  def pooled_query!(origin, query_str, params) when is_binary(origin) do
    checkout_from_pool(origin, fn -> query!(query_str, params) end)
  end

  @doc """
  Execute the given SQL query/statement in the context of a checked-out DB connection.

  This function assumes a connection has been checked out from a pool managed by
  `Electric.Postgres.Repo` and will fail if that's not the case. Use this to issue multiple
  queries/statements on a single DB connection by wrapping them in an anonymous function and
  passing it to `checkout_from_pool/2` or `pooled_transaction/2`.
  """
  @spec query!(String.t(), [term]) :: {[String.t()], [row]}
  def query!(query_str, params \\ []) when is_binary(query_str) and is_list(params) do
    true = Repo.checked_out?()

    %Postgrex.Result{columns: columns, rows: rows} = Repo.query!(query_str, params)
    {columns, rows}
  end
end
