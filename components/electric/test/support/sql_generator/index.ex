defmodule Electric.Postgres.SQLGenerator.Index do
  use Electric.Postgres.SQLGenerator

  def create_index(opts \\ []) do
    bind_filter(existing_table(opts), fn table ->
      exceptions = Keyword.get(opts, :except, [])
      concurrently? = :concurrently not in exceptions

      case table do
        nil ->
          :skip

        %{columns: []} ->
          :skip

        table ->
          {:cont,
           bind(member_of([true, false]), fn unique ->
             bind(index_columns(table, opts), fn index_columns ->
               bind(include_columns(table, index_columns, opts), fn include_columns ->
                 stmt([
                   "CREATE",
                   if(unique, do: constant("UNIQUE"), else: nil),
                   "INDEX",
                   if(concurrently?, do: optional("CONCURRENTLY")),
                   if(opts[:named] == :always,
                     do: stmt([ine(), name()]),
                     else: one_of([nil, stmt([ine(), name()])])
                   ),
                   "ON",
                   optional("ONLY"),
                   quote_table_name(table),
                   one_of([
                     nil,
                     # other index types either don't support unique indexes or need work to support integers
                     stmt([
                       "USING btree"
                     ])
                   ]),
                   column_name_list(index_columns, opts),
                   if(include_columns,
                     do:
                       frequency([
                         {4, nil},
                         {1, stmt(["INCLUDE", column_name_list(include_columns, opts)])}
                       ]),
                     else: nil
                   )
                 ])
               end)
             end)
           end)}
      end
    end)
  end

  def alter_index(opts \\ []) do
    bind(existing_index(opts), fn
      nil ->
        nil

      index ->
        if Keyword.get(opts, :only_supported, false) do
          stmt([
            "ALTER INDEX",
            optional("IF EXISTS"),
            Schema.name(index),
            stmt(["RENAME TO", name()])
          ])
        else
          # throw out loads of stuff that our schema tracking doesn't support
          frequency([
            {4,
             stmt([
               "ALTER INDEX",
               optional("IF EXISTS"),
               name(),
               frequency([
                 {10, stmt(["RENAME TO", name()])},
                 {1, stmt(["SET TABLESPACE", name()])},
                 {1, stmt(["SET (", name(), "=", int(1..19), ")"])},
                 {1, stmt(["RESET (", name(), ")"])},
                 {1,
                  stmt([
                    "ALTER",
                    optional("COLUMN"),
                    int(1..10),
                    "SET STATISTICS",
                    int(1..10)
                  ])}
               ])
             ])},
            {1,
             stmt([
               "ALTER INDEX ALL IN TABLESPACE",
               name(),
               one_of([nil, stmt(["OWNED BY", name()])]),
               "SET TABLESPACE",
               name(),
               optional("NOWAIT")
             ])},
            {1, stmt(["ALTER INDEX", name(), optional("NO"), "DEPENDS ON EXTENSION", name()])},
            {1, stmt(["ALTER INDEX", name(), "ATTACH PARTITION", name()])}
          ])
        end
    end)
  end

  defp existing_index(opts) do
    with %Proto.Schema{} = schema <- Keyword.get(opts, :schema) do
      case Schema.indexes(schema, include_constraints: Keyword.get(opts, :constraints, true)) do
        [_ | _] = indexes ->
          member_of(indexes)

        _ ->
          nil
      end
    else
      _ ->
        name()
    end
  end

  def drop_index(opts \\ []) do
    bind(existing_index(Keyword.put(opts, :constraints, false)), fn
      nil ->
        nil

      index ->
        stmt([
          "DROP INDEX",
          # "drop index concurrently does not support cascade"
          if(opts[:cascade], do: nil, else: optional("CONCURRENTLY")),
          optional("IF EXISTS"),
          Schema.name(index),
          if(opts[:cascade], do: "CASCADE", else: optional(["CASCADE", "RESTRICT"]))
        ])
    end)
  end

  # postgres=# \dOS
  @collations ~w(
    C.UTF-8 POSIX af-NA-x-icu af-ZA-x-icu af-x-icu agq-CM-x-icu agq-x-icu
    ak-GH-x-icu ak-x-icu am-ET-x-icu am-x-icu ar-001-x-icu ar-AE-x-icu
    ar-BH-x-icu ar-DJ-x-icu ar-DZ-x-icu ar-EG-x-icu ar-EH-x-icu ar-ER-x-icu
    ar-IL-x-icu ar-IQ-x-icu ar-JO-x-icu ar-KM-x-icu ar-KW-x-icu ar-LB-x-icu
    ar-LY-x-icu ar-MA-x-icu ar-MR-x-icu ar-OM-x-icu ar-PS-x-icu ar-QA-x-icu
    ar-SA-x-icu ar-SD-x-icu ar-SO-x-icu ar-SS-x-icu ar-SY-x-icu ar-TD-x-icu
    ar-TN-x-icu ar-YE-x-icu
  )

  def index_column() do
    frequency([
      {5, name()},
      {1, index_expression()}
    ])
    |> bind(&index_column/1)
  end

  def index_column({name, {class, _type}, _flags}) do
    tuple({
      constant(name),
      stmt(
        [
          quote_table_name(name),
          if(class in [:str],
            do:
              frequency([
                {8, nil},
                {1, stmt([constant("COLLATE"), member_of(@collations) |> quotes()])}
              ]),
            else: nil
          ),
          frequency([{3, nil}, {1, member_of(["ASC", "DESC"])}]),
          frequency([{3, nil}, {1, stmt([constant("NULLS"), member_of(["FIRST", "LAST"])])}])
        ]
        |> Enum.reject(&is_nil/1)
      )
    })
  end

  def index_columns(table, _opts \\ []) do
    table.columns
    |> member_of()
    |> uniq_list_of(min_length: 1, max_length: div(length(table.columns), 4))
    |> bind(fn columns ->
      Enum.map(columns, &index_column/1)
      |> fixed_list()
    end)
  end

  def include_columns(table, index_columns, _opts) do
    all = MapSet.new(table.columns, fn {name, _type, _flags} -> name end)
    used = MapSet.new(index_columns, fn {name, _defn} -> name end)
    available = MapSet.difference(all, used)

    if MapSet.size(available) == 0 do
      nil
    else
      available
      |> MapSet.to_list()
      |> member_of()
      |> uniq_list_of(min_length: 1, max_length: min(MapSet.size(available), 2))
      |> bind(fn columns ->
        Enum.map(columns, &include_column/1)
        |> fixed_list()
      end)
    end
  end

  def include_column(name) when is_binary(name) do
    {constant(name), constant(quote_table_name(name))}
  end

  def column_name_list(columns, _opts) do
    case columns do
      nil ->
        nil

      columns ->
        column_names =
          columns
          |> Enum.map(fn {_name, defn} -> defn end)
          |> Enum.map(&quote_table_name/1)

        stmt(
          [
            constant("("),
            stmt(column_names, ", "),
            constant(")")
          ],
          ""
        )
    end
  end

  defp index_expression do
    one_of([
      # 1-arity string functions
      stmt(["(", member_of(~w[upper trim length reverse]), "(", name(), ")", ")"], ""),
      # 2-arity string functions
      stmt(
        [
          "(",
          member_of(~w[left lpad repeat rpad substr]),
          "(",
          name(),
          ", ",
          integer(1..10) |> map(&to_string/1),
          ")",
          ")"
        ],
        ""
      )
    ])
  end
end
