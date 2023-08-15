defmodule Electric.Proxy.InjectorTest.SimpleQueryProtocol do
  alias PgProtocol.Message

  def description, do: "Simple query"
  def tag, do: :simple

  def begin_tx do
    [
      {
        [%Message.Query{query: "BEGIN"}],
        [
          %Message.CommandComplete{tag: "BEGIN"},
          %Message.ReadyForQuery{status: :tx}
        ]
      }
    ]
  end

  defp quote_value(i) when is_integer(i), do: "#{i}"
  defp quote_value(s) when is_binary(s), do: "'#{s}'"
  defp quote_value(%DateTime{} = ts), do: ts |> DateTime.to_string() |> quote_value()

  def migration(sql, opts) when is_binary(sql) do
    [
      {
        [
          %Message.Query{query: sql}
        ],
        [
          %Message.CommandComplete{tag: Keyword.fetch!(opts, :tag)},
          %Message.ReadyForQuery{status: :tx}
        ]
      }
    ]
  end

  def query(%{action: :insert, table: table, values: values, tag: tag}, opts) do
    column_names = Enum.map(values, fn {n, _} -> to_string(n) end) |> Enum.join(", ")

    column_values =
      values |> Enum.map(fn {_, v} -> quote_value(v) end) |> Enum.join(", ")

    sql =
      "INSERT INTO #{table.schema}.#{table.name} (#{column_names}) VALUES (#{column_values})"

    opts = Keyword.merge(opts, tag: tag)

    query(sql, opts)
  end

  def query(sql, opts) when is_binary(sql) do
    [
      {
        [
          %Message.Query{query: sql}
        ],
        [
          %Message.CommandComplete{tag: Keyword.fetch!(opts, :tag)},
          %Message.ReadyForQuery{status: :tx}
        ]
      }
    ]
  end

  def commit_tx() do
    [
      {
        [
          %Message.Query{query: "COMMIT"}
        ],
        [
          %Message.CommandComplete{tag: "COMMIT"},
          %Message.ReadyForQuery{status: :idle}
        ]
      }
    ]
  end
end
