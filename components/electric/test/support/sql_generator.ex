defmodule Electric.Postgres.SQLGenerator do
  import StreamData

  alias Electric.Postgres.{AST, Schema, Schema.Proto}
  alias __MODULE__.{Table, Index}

  defmacro __using__(_opts \\ []) do
    quote do
      alias Electric.Postgres.{AST, Schema, Schema.Proto}
      alias Electric.Postgres.SQLGenerator.Table

      import StreamData
      import Electric.Postgres.SQLGenerator
    end
  end

  @default_stream_types [
    :create_table,
    :create_table,
    :alter_table,
    :create_index,
    :alter_index,
    :drop_index,
    :drop_table
  ]

  defmodule SchemaAgent do
    use Agent

    alias Electric.{Postgres, Postgres.Schema}

    def start_link(schema \\ Schema.new()) do
      Agent.start_link(fn -> schema end)
    end

    def schema(pid) do
      Agent.get(pid, & &1)
    end

    def update(pid, sql) when is_binary(sql) do
      Agent.update(pid, fn schema ->
        Schema.update(schema, Postgres.parse!(sql), oid_loader: &oid_loader/3)
      end)
    end

    defp oid_loader(type, schema, name) do
      {:ok, Enum.join(["#{type}", schema, name], ".") |> :erlang.phash2(50_000)}
    end
  end

  def sql_stream(opts \\ []) do
    sql_stream(@default_stream_types, opts)
  end

  def sql_stream(types, opts) do
    schema_agent =
      if Keyword.get(opts, :use_schema, true) do
        Keyword.get_lazy(opts, :schema, fn ->
          {:ok, pid} = SchemaAgent.start_link()
          pid
        end)
      end

    create_table_opts = Keyword.get(opts, :create_table, [])
    alter_table_opts = Keyword.get(opts, :alter_table, [])
    create_index_opts = Keyword.get(opts, :create_index, [])

    StreamData.bind_filter(
      StreamData.member_of(types),
      fn type ->
        schema = if schema_agent, do: SchemaAgent.schema(schema_agent)

        default_generator =
          case type do
            :create_table ->
              Table.create_table(Keyword.put(create_table_opts, :schema, schema))

            :alter_table ->
              Table.alter_table(Keyword.put(alter_table_opts, :schema, schema))

            :drop_table ->
              Table.drop_table(schema: schema)

            :create_index ->
              Index.create_index(Keyword.put(create_index_opts, :schema, schema))

            :alter_index ->
              Index.alter_index(schema: schema)

            :drop_index ->
              Index.drop_index(schema: schema)
          end

        generator =
          case schema do
            nil ->
              default_generator

            %{tables: tables} when length(tables) > 3 ->
              default_generator

            _ ->
              Table.create_table(Keyword.put(create_table_opts, :schema, schema))
          end

        {:cont,
         bind_filter(generator, fn sql ->
           case sql do
             nil ->
               :skip

             sql when is_binary(sql) ->
               if schema_agent, do: SchemaAgent.update(schema_agent, sql)
               {:cont, constant(sql)}
           end
         end)}
      end,
      _max_consecutive_failures = 100
    )
  end

  def quotes(str) do
    str |> map(&quote_name/1)
  end

  def quote_name(name) when is_binary(name) do
    "\"" <> name <> "\""
  end

  def esc(str) do
    String.replace(str, "'", "''")
  end

  def safe_member_of(list, empty \\ nil)

  def safe_member_of([], empty) do
    empty
  end

  def safe_member_of(list, _empty) do
    member_of(list)
  end

  def valid,
    do:
      tuple({
        string([?a..?z, ?A..?Z], min_length: 6, max_length: 12),
        member_of(["", "_"]),
        string(Enum.concat([?a..?z, ?A..?Z]), min_length: 8, max_length: 18),
        string(Enum.concat([?a..?z, ?A..?Z]), min_length: 8, max_length: 18)
      })
      |> map(fn {a, j, c, d} -> a <> j <> c <> j <> d end)
      |> unshrinkable()

  def quoted, do: valid() |> quotes()

  # always using quoted because otherwise there's no guarantee that we won't accidentally
  # generated a reserved keyword
  def name(quoted \\ true)

  def name(false), do: valid()
  def name(true), do: quoted()

  def optional(gen) do
    member_of([nil | List.wrap(gen)])
  end

  def ine do
    optional("IF NOT EXISTS")
  end

  def stmt(clauses, join \\ " ") do
    clauses
    |> Enum.map(&string_to_constant/1)
    |> fixed_list()
    |> bind(fn c ->
      c
      |> Stream.reject(&is_nil/1)
      |> Enum.intersperse(join)
      |> IO.iodata_to_binary()
      |> String.trim()
      |> constant()
    end)
  end

  defp string_to_constant(clause) when is_binary(clause) do
    constant(clause)
  end

  defp string_to_constant(clause), do: clause

  def int(range) do
    integer(range) |> map(&to_string/1)
  end

  def quote_table_name(%Proto.RangeVar{schema: schema, name: name}) do
    quote_table_name({schema, name})
  end

  def quote_table_name(%{name: name}) do
    quote_table_name(name)
  end

  def quote_table_name({nil, name}) do
    quote_name(name)
  end

  def quote_table_name({schema, name}) do
    "#{quote_name(schema)}.#{quote_name(name)}"
  end

  def quote_table_name("\"" <> _rest = name) do
    name
  end

  def quote_table_name(name) when is_binary(name) do
    quote_name(name)
  end

  def existing_table(opts) do
    case Keyword.get(opts, :schema) do
      %Proto.Schema{tables: []} ->
        nil

      %Proto.Schema{tables: [_ | _]} = schema ->
        member_of(schema.tables) |> map(&map_table/1)

      _ ->
        __MODULE__.Table.table_definition(opts)
    end
  end

  defdelegate map_table(table), to: __MODULE__.Table
end
