defmodule Electric.ShapeCache.ShapeStatus.ShapeDb.Query do
  @read_queries [
    list_shapes: """
    SELECT handle, shape FROM shapes ORDER BY handle
    """,
    list_shape_meta: """
    SELECT handle, hash, snapshot_complete FROM shapes ORDER BY handle
    """,
    handle_exists: """
    SELECT 1 FROM shapes WHERE handle = ?1
    """,
    handle_lookup: """
    SELECT handle FROM shapes WHERE comparable = ?1 LIMIT 1
    """,
    shape_lookup: """
    SELECT shape FROM shapes WHERE handle = ?1 LIMIT 1
    """,
    relation_handle_lookup: """
    SELECT handle FROM relations WHERE oid = ?1 LIMIT 1
    """,
    shape_count: """
    SELECT count FROM shape_count WHERE id = 1 LIMIT 1
    """
  ]
  @write_queries Keyword.merge(
                   [
                     insert_shape: """
                     INSERT INTO shapes (handle, shape, comparable, hash) VALUES (?1, ?2, ?3, ?4)
                     """,
                     insert_relation: """
                     INSERT INTO relations (handle, oid) VALUES (?1, ?2)
                     """,
                     increment_counter: """
                     UPDATE shape_count SET count = count + ?1 WHERE id = 1
                     """,
                     delete_shape: """
                     DELETE FROM shapes WHERE handle = ?1
                     """,
                     delete_relation: """
                     DELETE FROM relations WHERE handle = ?1
                     """,
                     mark_snapshot_complete: """
                     UPDATE shapes SET snapshot_complete = 1 WHERE handle = ?1
                     """,
                     # only shapes that have completed their snapshot are valid
                     select_invalid: """
                     SELECT handle FROM shapes WHERE snapshot_complete = 0 ORDER BY handle
                     """
                   ],
                   # need the handle_lookup query in the write connection to
                   # allow for handle lookup to definitely read all writes
                   Keyword.take(@read_queries, [:handle_lookup])
                 )

  defstruct Enum.uniq(Keyword.keys(@read_queries) ++ Keyword.keys(@write_queries))

  alias Electric.ShapeCache.ShapeStatus.ShapeDb.Connection, as: Conn

  alias Exqlite.Sqlite3

  import Conn,
    only: [
      execute_all: 2,
      fetch_all: 4,
      fetch_all: 3,
      fetch_one: 3,
      modify: 3,
      stream_query: 3
    ]

  def prepare!(conn, opts) do
    case Keyword.get(opts, :mode, :readwrite) do
      :readwrite ->
        struct(__MODULE__, prepare_stmts!(conn, @read_queries ++ @write_queries))

      :read ->
        struct(__MODULE__, prepare_stmts!(conn, @read_queries))

      :write ->
        struct(__MODULE__, prepare_stmts!(conn, @write_queries))
    end
  end

  defp prepare_stmts!(conn, sqls) do
    Enum.map(sqls, fn {name, sql} ->
      case Sqlite3.prepare(conn, sql) do
        {:ok, stmt} ->
          {name, stmt}

        {:error, _reason} = error ->
          raise Electric.ShapeCache.ShapeStatus.ShapeDb.Error,
            action: :prepare_stmts,
            error: error
      end
    end)
  end

  def add_shape(
        %Conn{conn: conn, stmts: stmts},
        shape_handle,
        shape,
        comparable_shape,
        shape_hash,
        relations
      ) do
    %{
      insert_shape: insert_shape,
      insert_relation: insert_relation,
      increment_counter: increment_counter
    } = stmts

    with {:ok, 1} <-
           modify(conn, insert_shape, [
             {:blob, shape_handle},
             {:blob, term_to_binary(shape)},
             {:blob, comparable_to_binary(comparable_shape)},
             shape_hash
           ]),
         :ok <- increment_counter(conn, increment_counter, 1),
         :ok <-
           Enum.reduce_while(relations, :ok, fn {oid, _name}, :ok ->
             case modify(conn, insert_relation, [{:blob, shape_handle}, oid]) do
               {:ok, 1} -> {:cont, :ok}
               error -> {:halt, error}
             end
           end) do
      :ok
    end
  end

  def list_shapes(%Conn{conn: conn, stmts: %{list_shapes: stmt}}) do
    fetch_all(conn, stmt, [], fn [handle, serialized_shape] ->
      {handle, :erlang.binary_to_term(serialized_shape)}
    end)
  end

  def handle_for_shape(%Conn{conn: conn, stmts: %{handle_lookup: stmt}}, comparable_shape) do
    with {:ok, [handle]} <-
           fetch_one(conn, stmt, [{:blob, comparable_to_binary(comparable_shape)}]) do
      {:ok, handle}
    end
  end

  def shape_for_handle(%Conn{conn: conn, stmts: %{shape_lookup: stmt}}, shape_handle) do
    with {:ok, [serialized_shape]} <- fetch_one(conn, stmt, [{:blob, shape_handle}]) do
      {:ok, :erlang.binary_to_term(serialized_shape)}
    end
  end

  def handle_exists?(%Conn{conn: conn, stmts: %{handle_exists: stmt}}, shape_handle) do
    case fetch_one(conn, stmt, [{:blob, shape_handle}]) do
      {:ok, [1]} -> true
      :error -> false
    end
  end

  def shape_handles_for_relations(%Conn{conn: conn}, relations) do
    {placeholders, binds} =
      Enum.map_reduce(Enum.with_index(relations, 1), %{}, fn {{oid, _relation}, idx}, binds ->
        {"@oid#{idx}", Map.put(binds, "@oid#{idx}", oid)}
      end)

    sql =
      "SELECT handle FROM relations WHERE oid IN (#{Enum.join(placeholders, ", ")}) ORDER BY handle"

    fetch_all(conn, sql, binds, fn [handle] -> handle end)
  end

  def count_shapes(%Conn{conn: conn, stmts: %{shape_count: stmt}}) do
    with {:ok, [count]} <- fetch_one(conn, stmt, []) do
      {:ok, count}
    end
  end

  def mark_snapshot_complete(
        %Conn{conn: conn, stmts: %{mark_snapshot_complete: stmt}},
        shape_handle
      ) do
    with {:ok, n} <- modify(conn, stmt, [{:blob, shape_handle}]) do
      if n == 1, do: :ok, else: :error
    end
  end

  def remove_shape(%Conn{conn: conn, stmts: stmts}, shape_handle) do
    %{
      delete_shape: delete_shape,
      delete_relation: delete_relation,
      increment_counter: increment_counter
    } = stmts

    case modify(conn, delete_shape, [{:blob, shape_handle}]) do
      {:ok, 0} ->
        {:error, {:enoshape, shape_handle}}

      {:ok, 1} ->
        with :ok <- increment_counter(conn, increment_counter, -1),
             {:ok, _} <- modify(conn, delete_relation, [{:blob, shape_handle}]) do
          :ok
        end
    end
  end

  defp increment_counter(conn, stmt, incr) do
    case modify(conn, stmt, [incr]) do
      {:ok, 1} -> :ok
      {:ok, _} -> {:error, "Failed to increment shape count by #{incr}"}
      error -> error
    end
  end

  def select_invalid(%Conn{conn: conn, stmts: %{select_invalid: select_invalid}}) do
    fetch_all(conn, select_invalid, [], fn [handle] -> handle end)
  end

  def list_shape_stream(%Conn{conn: conn, stmts: %{list_shapes: stmt}}) do
    stream_query(conn, stmt, fn [handle, shape] ->
      {handle, :erlang.binary_to_term(shape)}
    end)
  end

  def list_shape_meta_stream(%Conn{conn: conn, stmts: %{list_shape_meta: stmt}}) do
    stream_query(conn, stmt, fn [handle, hash, snapshot_complete] ->
      {handle, hash, snapshot_complete == 1}
    end)
  end

  def reset(%Conn{conn: conn}) do
    execute_all(conn, [
      "DELETE FROM shapes",
      "DELETE FROM relations",
      "UPDATE shape_count SET count = 0"
    ])
  end

  def explain(%Conn{} = conn, :read) do
    do_explain(conn, :read, @read_queries)
  end

  def explain(%Conn{} = conn, :write) do
    do_explain(conn, :write, @write_queries)
  end

  defp do_explain(%Conn{conn: conn, stmts: stmts}, mode, mode_queries) do
    IO.puts(
      IO.ANSI.format([
        [:bright, "\n============================\n", :reset],
        [:bright, "#{mode}\n", :reset],
        [:bright, "============================\n", :reset]
      ])
    )

    for {name, sql} <- mode_queries do
      binds =
        Stream.repeatedly(fn -> "" end)
        |> Enum.take(Sqlite3.bind_parameter_count(Map.fetch!(stmts, name)))

      with {:ok, rows} <- fetch_all(conn, "EXPLAIN QUERY PLAN " <> sql, binds) do
        plan =
          rows
          |> Enum.map(fn [_, _, _, s] -> s end)
          |> Enum.map(fn plan ->
            colour =
              cond do
                String.contains?(plan, "USING COVERING INDEX") -> :green
                String.contains?(plan, "USING INDEX") -> :cyan
                true -> :red
              end

            [:bright, colour, plan, :reset]
          end)

        IO.puts(
          IO.ANSI.format([
            [:bright, "#{name}", :reset],
            ": [#{String.trim_trailing(sql)}] ",
            plan |> Enum.intersperse(", ")
          ])
        )
      end
    end
  end

  defp term_to_binary(term), do: :erlang.term_to_binary(term, [:deterministic])

  defp comparable_to_binary(comparable_shape) do
    comparable_shape
    |> term_to_binary()
    |> then(&:crypto.hash(:sha256, &1))
  end
end
