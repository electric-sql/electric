defmodule Electric.Proxy.InjectorTest.ExtendedQueryProtocol do
  alias PgProtocol.Message

  def description, do: "Extended query"
  def tag, do: :extended

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

  def migration(sql, opts) do
    [
      {
        [
          %Message.Parse{
            name: "",
            query: sql,
            params: []
          },
          %Message.Describe{type: "S", name: ""},
          %Message.Flush{}
        ],
        [
          %Message.ParseComplete{},
          %Message.ParameterDescription{params: []},
          %Message.NoData{}
        ]
      },
      {
        List.flatten([
          %Message.Bind{
            portal: "",
            source: "",
            parameter_format_codes: [],
            parameters: [],
            result_format_codes: []
          },
          %Message.Execute{portal: "", max_rows: 0},
          %Message.Close{type: "S", name: ""},
          %Message.Sync{}
        ]),
        [
          %Message.BindComplete{},
          %Message.CommandComplete{tag: Keyword.fetch!(opts, :tag)},
          %Message.CloseComplete{},
          %Message.ReadyForQuery{status: :tx}
        ]
      }
    ]
  end

  def query(%{action: :insert, table: table, values: values, name: name, tag: tag}, opts) do
    column_names = Enum.map(values, fn {n, _} -> to_string(n) end) |> Enum.join(", ")

    placeholders =
      values |> Enum.with_index(1) |> Enum.map(fn {_, n} -> "$#{n}" end) |> Enum.join(", ")

    binds =
      values
      |> Enum.map(fn {name, value} ->
        {bind_type(Map.fetch!(table.columns, name).type), value}
      end)

    sql = "INSERT INTO #{table.schema}.#{table.name} (#{column_names}) VALUES (#{placeholders})"
    opts = Keyword.merge(opts, binds: binds, name: name, tag: tag)

    query(sql, opts)
  end

  def query(sql, opts) when is_binary(sql) do
    name =
      Keyword.get_lazy(opts, :name, fn -> :crypto.strong_rand_bytes(8) |> Base.encode16() end)

    binds = Keyword.get(opts, :binds, [])

    [
      {
        [
          %Message.Close{type: "S", name: name},
          %Message.Parse{name: name, query: sql, params: []},
          %Message.Describe{type: "S", name: name},
          %Message.Flush{}
        ],
        [
          %Message.CloseComplete{},
          %Message.ParseComplete{},
          %Message.ParameterDescription{params: Enum.map(binds, &elem(&1, 0))},
          %Message.NoData{}
        ]
      },
      {
        [
          %Message.Bind{
            portal: "",
            source: name,
            parameter_format_codes: Enum.map(binds, fn _ -> 1 end),
            parameters: binds |> Enum.map(&elem(&1, 1)) |> Enum.map(&version_pg/1),
            result_format_codes: []
          },
          %Message.Execute{portal: "", max_rows: 0},
          %Message.Sync{}
        ],
        [
          %Message.BindComplete{},
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

  defp bind_type(:int8), do: 20
  defp bind_type(:timestamptz), do: 1114

  defp version_pg(version) when is_integer(version) do
    <<version::integer-signed-big-64>>
  end

  defp version_pg(%DateTime{} = datetime) do
    datetime
    |> DateTime.to_unix(:microsecond)
    |> version_pg()
  end
end
