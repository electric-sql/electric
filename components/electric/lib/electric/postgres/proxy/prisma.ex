defmodule Electric.Postgres.Proxy.Prisma do
  defstruct server_version: {"14.9", 140_009}

  @type t() :: %__MODULE__{server_version: {binary(), integer()}}

  alias Electric.Postgres.Proxy.Injector
  alias Electric.Postgres.Proxy.Prisma.Query

  require Logger

  def parse_query("SELECT version()" <> _rest) do
    {:ok, Electric.Postgres.Proxy.Prisma.Query.VersionV5_2}
  end

  def parse_query(sql) do
    case Electric.Postgres.parse!(sql) do
      [stmt] -> analyse_stmt(stmt, sql)
      # > 1 statement means it's not an introspection query, as they are all parse
      # messages, which can only have 1 statement
      [_ | _] -> :passthrough
    end
  end

  @query_modules [
    # 4.8 - queries are slightly simpler so tests for 4.8 are limited to query recognition
    Query.TableListV4_8,
    Query.TypeV4_8,
    Query.ColumnV4_8,
    Query.ForeignKeyV4_8,
    Query.IndexV4_8,
    Query.ViewV4_8,
    # 5.2
    Query.NamespaceVersionV5_2,
    Query.NamespaceV5_2,
    Query.TableV5_2,
    Query.ConstraintV5_2,
    Query.ViewV5_2,
    Query.TypeV5_2,
    Query.ColumnV5_2,
    Query.ForeignKeyV5_2,
    Query.IndexV5_2,
    Query.FunctionV5_2,
    Query.ExtensionV5_2,
    Query.SequenceV5_2
  ]

  defp analyse_stmt(%PgQuery.SelectStmt{} = stmt, sql) do
    query_columns = target_list_names(stmt)

    if module = Enum.find(@query_modules, &(&1.column_names() == query_columns)) do
      Logger.info("Matched prisma introspection query to #{module}")
      {:ok, module}
    else
      Logger.error(
        "Received unknown prisma introspection query: #{inspect(sql)} with columns #{inspect(query_columns)}"
      )

      :error
    end
  end

  defp analyse_stmt(_stmt, _sql) do
    :passthrough
  end

  defp target_list_names(%{target_list: target_list}) do
    Enum.map(target_list, fn
      %{node: {:res_target, %{name: "", val: %{node: {:column_ref, %{fields: fields}}}}}} ->
        Enum.map(fields, fn %{node: {:string, %{sval: s}}} -> s end) |> Enum.join(".")

      %{node: {:res_target, %{name: name}}} ->
        name
    end)
  end

  defmacro i32 do
    quote do: integer - signed - big - 32
  end

  # the only array params used are to hold the list of schemas
  # which is a 1-dimensional array of type 19 (name)
  # it looks like this:
  # <<
  #   0, 0, 0, 1,  # dimensions
  #   0, 0, 0, 0,  # null bitmap
  #   0, 0, 0, 19, # type of elements
  #   0, 0, 0, 1,  # size of 1st dimension
  #   0, 0, 0, 1,  # starting index first dimension
  #   0, 0, 0, 6,  # length of 1st element
  #   112, 117, 98, 108, 105, 99 # data for 1st element
  # >>
  def parse_bind_array(encoded_array) do
    case encoded_array do
      <<
        1::i32(),
        0::i32(),
        19::i32(),
        1::i32(),
        1::i32(),
        len::i32(),
        value::binary-size(len)
      >> ->
        [value]
    end
  end

  def injector(config, opts \\ []) do
    capture = {Injector.Prisma, config: config}

    Injector.new(Keyword.merge(opts, capture_mode: [default: capture]),
      username: "username",
      database: "database"
    )
  end
end
