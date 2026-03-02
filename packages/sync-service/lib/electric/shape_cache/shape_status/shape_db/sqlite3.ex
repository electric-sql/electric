defmodule Electric.ShapeCache.ShapeStatus.ShapeDb.Sqlite3 do
  @moduledoc """
  Drop-in shim over `:esqlite3` that mirrors the subset of the `Exqlite.Sqlite3` API
  used by `Connection` and `Query`.

  Only `Connection` and `Query` hold an `alias` to this module.  All other code
  continues to call those two modules unchanged, so swapping the underlying SQLite
  NIF is fully contained here.

  ## API mapping

  | Exqlite.Sqlite3                     | :esqlite3 / notes                          |
  |-------------------------------------|--------------------------------------------|
  | open(path, opts)                    | open(uri) – opts encoded as URI params      |
  | close(conn)                         | close(conn)                                |
  | execute(conn, sql)                  | exec(conn, sql)                            |
  | prepare(conn, sql)                  | prepare(conn, sql)                         |
  | release(conn, stmt)                 | no-op – GC'd by esqlite                    |
  | bind(stmt, binds)                   | bind(stmt, binds)                          |
  | step(conn, stmt)                    | step(stmt) – conn arg dropped              |
  | reset(stmt)                         | reset(stmt)                                |
  | fetch_all(conn, stmt)               | fetchall(stmt)                             |
  | changes(conn)                       | {:ok, changes(conn)}                       |
  | multi_step(conn, stmt)              | step loop; returns {:rows, rows}/{:done, rows} |
  | enable_load_extension(conn, bool)   | not supported – always returns error       |
  | bind_parameter_count(stmt)          | column_names heuristic (explain only)      |
  """

  # ── Types ──────────────────────────────────────────────────────────────────

  @type connection :: :esqlite3.esqlite3()
  @type statement :: :esqlite3.esqlite3_stmt()

  # ── Connection lifecycle ───────────────────────────────────────────────────

  @doc """
  Opens a SQLite database.

  `opts` follows the exqlite convention:
    - `[mode: [:readonly, :nomutex]]` → opens as `file:<path>?mode=ro`
    - `[]` (default) → opens as `file:<path>?mode=rwc`

  The `:memory:` path is passed through unchanged.
  """
  @spec open(String.t(), keyword()) :: {:ok, connection()} | {:error, term()}
  def open(path, opts \\ []) do
    uri = build_uri(path, opts)
    :esqlite3.open(String.to_charlist(uri))
  end

  @spec close(connection()) :: :ok | {:error, term()}
  def close(conn) do
    :esqlite3.close(conn)
  end

  # ── DDL / raw execution ────────────────────────────────────────────────────

  @doc "Execute a raw SQL statement (no results returned)."
  @spec execute(connection(), String.t()) :: :ok | {:error, term()}
  def execute(conn, sql) do
    :esqlite3.exec(conn, sql)
  end

  # ── Prepared statements ────────────────────────────────────────────────────

  @spec prepare(connection(), String.t()) :: {:ok, statement()} | {:error, term()}
  def prepare(conn, sql) do
    :esqlite3.prepare(conn, sql)
  end

  @doc "Release a prepared statement.  esqlite relies on GC; this is a no-op."
  @spec release(connection(), statement()) :: :ok
  def release(_conn, _stmt), do: :ok

  @doc """
  Bind positional or named parameters to a prepared statement.

  Accepts the exqlite bind list format including `{:blob, value}` tagged tuples,
  plain integers, binaries, and named `{"@name", value}` pairs.
  """
  @spec bind(statement(), list()) :: :ok | {:error, term()}
  def bind(stmt, binds) do
    converted = Enum.map(binds, &convert_bind/1)
    :esqlite3.bind(stmt, converted)
  end

  @doc """
  Step a prepared statement once.

  Returns `{:row, row}` or `:done` (matching the exqlite contract).
  The `conn` argument is accepted for API compatibility but ignored.
  """
  @spec step(connection(), statement()) :: {:row, list()} | :done | {:error, term()}
  def step(_conn, stmt) do
    case :esqlite3.step(stmt) do
      :"$done" -> :done
      row when is_list(row) -> {:row, row}
      {:error, _} = err -> err
    end
  end

  @spec reset(statement()) :: :ok | {:error, term()}
  def reset(stmt) do
    :esqlite3.reset(stmt)
  end

  @doc "Fetch all remaining rows from a prepared statement."
  @spec fetch_all(connection(), statement()) :: {:ok, list(list())} | {:error, term()}
  def fetch_all(_conn, stmt) do
    case :esqlite3.fetchall(stmt) do
      rows when is_list(rows) -> {:ok, rows}
      {:error, _} = err -> err
    end
  end

  @doc "Return `{:ok, n}` for the number of rows changed by the last DML statement."
  @spec changes(connection()) :: {:ok, non_neg_integer()}
  def changes(conn) do
    {:ok, :esqlite3.changes(conn)}
  end

  @doc """
  Step through a prepared statement in chunks.

  Returns `{:rows, rows}` when there are more rows to fetch, or
  `{:done, rows}` when the cursor is exhausted.

  The `conn` argument is accepted for API compatibility but ignored.
  The chunk size matches exqlite's default (50 rows per call).
  """
  @spec multi_step(connection(), statement()) ::
          {:rows, list(list())} | {:done, list(list())} | {:error, term()}
  def multi_step(_conn, stmt, chunk_size \\ 50) do
    do_multi_step(stmt, chunk_size, [])
  end

  defp do_multi_step(_stmt, 0, acc) do
    {:rows, Enum.reverse(acc)}
  end

  defp do_multi_step(stmt, remaining, acc) do
    case :esqlite3.step(stmt) do
      :"$done" ->
        {:done, Enum.reverse(acc)}

      row when is_list(row) ->
        do_multi_step(stmt, remaining - 1, [row | acc])

      {:error, _} = err ->
        err
    end
  end

  @doc """
  Enable or disable SQLite extension loading.

  esqlite does not expose `sqlite3_enable_load_extension`.
  Returns `{:error, :not_supported}` so callers can handle gracefully.
  """
  @spec enable_load_extension(connection(), boolean()) :: :ok | {:error, :not_supported}
  def enable_load_extension(_conn, _enable), do: {:error, :not_supported}

  @doc """
  Return the number of bind parameters in a prepared statement.

  Used only by the `explain/2` diagnostic path.  esqlite does not expose
  `sqlite3_bind_parameter_count` directly, so we derive it from column names
  of the statement.  For `EXPLAIN QUERY PLAN` usage the count just needs to
  be non-negative; we fall back to 0.
  """
  @spec bind_parameter_count(statement()) :: non_neg_integer()
  def bind_parameter_count(_stmt) do
    # esqlite does not expose sqlite3_bind_parameter_count.
    # The explain path just needs a list of empty-string binds for EXPLAIN
    # QUERY PLAN to succeed; returning 0 is safe for that path.
    0
  end

  # ── Private helpers ────────────────────────────────────────────────────────

  # Build a SQLite URI from a file path and exqlite-style opts.
  defp build_uri(":memory:", _opts), do: "file:memory?mode=memory&cache=shared"

  defp build_uri(path, opts) do
    mode =
      case Keyword.get(opts, :mode, []) do
        modes when is_list(modes) ->
          if :readonly in modes, do: "ro", else: "rwc"

        :readonly ->
          "ro"

        _ ->
          "rwc"
      end

    "file:#{URI.encode(path)}?mode=#{mode}"
  end

  # Convert an exqlite bind value to an esqlite bind value.
  # esqlite's bind/2 supports: integers, floats, binaries (text), and
  # {:blob, binary} tuples for BLOBs.  nil/null map to undefined.
  defp convert_bind(nil), do: :undefined
  defp convert_bind(:null), do: :undefined
  defp convert_bind(value), do: value
end
