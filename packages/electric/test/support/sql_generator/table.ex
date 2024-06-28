defmodule Electric.Postgres.SQLGenerator.Table do
  use Electric.Postgres.SQLGenerator

  alias Electric.Postgres.Schema

  import Electric.Postgres.SQLGenerator.Column

  defstruct [:name, columns: [], constraints: [], indexes: []]

  def map_table(%Proto.Table{} = table) do
    %__MODULE__{
      name: map_table_name(table.name),
      columns: map_table_columns(table.columns, table),
      constraints: map_table_constraints(table.constraints),
      indexes: map_table_indexes(table.indexes)
    }
  end

  defp map_table_name(%Proto.RangeVar{} = name) do
    {name.schema, name.name}
  end

  defp map_table_columns(columns, table) do
    Enum.map(columns, fn col ->
      {col.name, class_from_type(col.type), col_flags(col, table)}
    end)
  end

  defp col_flags(column, table) do
    pk =
      Enum.find_value(table.constraints, fn
        %{constraint: {:primary, pk}} -> pk
        _ -> false
      end)

    %{pk: (pk && column.name in pk.keys) == true}
  end

  defp map_table_constraints(constraints) do
    constraints
    |> Enum.map(fn %Proto.Constraint{constraint: {t, c}} ->
      {t, {c.name, Schema.Catalog.keys(c)}}
    end)
  end

  defp map_table_indexes(indexes) do
    Enum.map(indexes, &{&1.name, Schema.Catalog.keys(&1)})
  end

  # - types: list of column data types e.g. [{:int, "integer"}]
  def table_definition(opts) do
    namespace = Keyword.get(opts, :namespace, nil)

    name_gen =
      case Keyword.get(opts, :table_name) do
        nil -> name(false)
        name when is_binary(name) -> constant(name)
      end

    fixed_map(%{
      name: tuple({constant(namespace), name_gen}),
      columns: column_list(opts),
      constraints: constraint_list(opts)
    })
    |> map(&struct(Table, &1))
  end

  defp constraint_list(_opts) do
    {member_of([:foreign, :unique]), {name(false), constant([])}}
    |> tuple()
    |> list_of(max_length: 3)
  end

  # opts:
  #
  # - temporary_tables: true - allow for creation of temporary/unlogged tables
  # - foreign_keys: true - allow for foreign key references
  # - serial: true - allow for serial types
  # - table_constraints: true enable table constraints as well as column constraints
  #
  def create_table(opts) do
    bind(table_definition(opts), fn table ->
      create_table(table, opts)
    end)
  end

  def create_table(%Table{} = table, opts) do
    bind(create_table_opts(opts), fn table_opts ->
      stmt(
        [
          create_table_clause(table, opts),
          " (\n  ",
          table_elts(table, table_opts, opts),
          # columns(columns, table_opts, opts[:columns] || []),
          # table_constraints(columns, table_opts),
          "\n)"
        ],
        ""
      )
    end)
  end

  # don't return a schema.table pair because it just means you have to ensure the schema exists if
  # you run against a db
  def table_name do
    name()
  end

  def create_table_clause(%Table{name: name}, opts) do
    allow_temporary = Keyword.get(opts, :temporary_tables, true)

    stmt([
      "CREATE",
      if(allow_temporary,
        do:
          one_of([
            nil,
            stmt([
              optional(["GLOBAL", "LOCAL"]),
              member_of(["TEMPORARY", "TEMP"])
            ]),
            optional("UNLOGGED")
          ]),
        else: nil
      ),
      "TABLE",
      ine(),
      quote_table_name(name)
    ])
  end

  def table_elts(%Table{} = table, table_opts, opts) do
    pks = Enum.filter(table.columns, fn {_, _, %{pk: pk}} -> pk end)
    table_opts = %{table_opts | pk: if(length(pks) > 1, do: :table, else: :column)}

    [
      columns(table.columns, table_opts, opts),
      table_constraints(table, table_opts, opts)
    ]
    |> fixed_list()
    |> bind(fn elts ->
      # constant(stmt(elts, ",\n  "))
      elts
      |> Enum.concat()
      |> Enum.reject(&is_nil/1)
      |> Enum.intersperse(",\n  ")
      |> Enum.map(&constant/1)
      |> fixed_list()
    end)
  end

  defp table_constraints(_table, %{pk: :column, fk: :none}, _opts) do
    fixed_list([])
  end

  defp table_constraints(_table, %{pk: :column, fk: :column}, _opts) do
    fixed_list([])
  end

  defp table_constraints(table, %{pk: pk, fk: fk}, opts) do
    if Keyword.get(opts, :table_constraints, true) do
      fixed_list([
        table_foreign_key(table, fk, opts),
        table_unique_primary(table, pk),
        table_check(table)
      ])
      |> map(&List.flatten/1)
    else
      fixed_list([])
    end
  end

  defp table_unique_primary(%Table{} = table, :table) do
    # need to be sure that primary key and unique constraints aren't duplicates - no point adding
    # a unique constraint to a column that's already a primary key
    column_map = MapSet.new(table.columns)

    pk_cols = Enum.filter(table.columns, fn {_, _, flags} -> flags[:pk] end)

    pk_map = MapSet.new(pk_cols)
    use_cols = MapSet.difference(column_map, pk_map) |> MapSet.to_list()

    bind(column_selection(use_cols), fn uniq_cols ->
      fixed_list([
        table_primary_key(pk_cols),
        table_unique(table.columns, uniq_cols)
      ])
      |> map(&Enum.reject(&1, fn e -> is_nil(e) end))
    end)
  end

  defp table_unique_primary(_columns, _) do
    nil
  end

  # not used now we enforce a pk and do it on a column
  defp table_primary_key(key_cols) do
    keys = join_columns(key_cols)

    stmt([
      "PRIMARY KEY (",
      fixed_list(keys),
      ")"
    ])
  end

  defp table_foreign_key(_table, :none, _opts) do
    nil
  end

  defp table_foreign_key(_table, :column, _opts) do
    nil
  end

  defp table_foreign_key(table, :table, opts) do
    one_of([
      nil,
      bind(column_selection(table.columns, max_length: 1), fn [key_col | _] ->
        # I'm limiting foreign keys to a single entry, even though  in theory you can have
        # multiple entries here otherwise it's difficult to match up the types (since the local
        # and foreign keys need to be of the same type)
        keys = join_columns([key_col])

        {_name, {_class, type}, _flags} = key_col

        bind(
          table_reference(type, opts[:schema], Keyword.put(opts, :owning_table, table)),
          fn
            nil ->
              nil

            ref ->
              stmt([
                "FOREIGN KEY (",
                fixed_list(keys),
                ")",
                ref
              ])
          end
        )
      end)
    ])
  end

  defp table_check(table) do
    one_of([
      constant([]),
      bind(list_of(member_of(table.columns), min_length: 1, max_length: 4), fn cols ->
        cols
        |> Stream.filter(&column_checkable?/1)
        |> Enum.map(&check(&1, max_length: 1))
        |> fixed_list()
      end)
    ])
  end

  defp table_unique(columns, key_cols) do
    include_cols = Enum.reject(columns, fn col -> col in key_cols end)

    if Enum.empty?(key_cols) do
      nil
    else
      one_of([
        nil,
        bind(column_selection(include_cols, min_length: 1), fn inc_cols ->
          keys = join_columns(key_cols)
          inc = join_columns(inc_cols)

          stmt([
            "UNIQUE",
            # pg-15 only
            # optional(["NULLS DISTINCT", "NULLS NOT DISTINCT"]),
            stmt(["(", fixed_list(keys), ")"], ""),
            if(Enum.empty?(inc),
              do: nil,
              else: stmt(["INCLUDE (", fixed_list(inc), ")"], "")
            )
          ])
        end)
      ])
    end
  end

  defp column_checkable?({_name, {class, _type}, _flags}) do
    class not in [:serial]
  end

  defp join_columns(cols) do
    cols
    |> Stream.map(&elem(&1, 0))
    |> Stream.intersperse(", ")
    |> Enum.map(&constant/1)
  end

  defp column_list(opts) do
    bind(uniq_list_of(name(), min_length: Keyword.get(opts, :min_columns, 1)), fn names ->
      max = max(1, min(3, div(length(names), 2)))

      bind(
        uniq_list_of(member_of(names), min_length: 1, max_length: max),
        fn pk_columns ->
          names
          |> Enum.map(&tuple({constant(&1), datatype(opts), column_flags(&1, pk_columns)}))
          |> fixed_list()
        end
      )
    end)
  end

  defp column_flags(column, pk_columns) do
    constant(%{pk: column in pk_columns})
  end

  defp column_selection(columns, opts \\ [])

  defp column_selection([], _opts) do
    fixed_list([])
  end

  defp column_selection(columns, opts) do
    gen_opts =
      opts
      |> Keyword.put_new(:min_length, 1)
      |> Keyword.put_new(:max_length, min(div(length(columns), 2), 4))

    columns
    |> member_of()
    |> uniq_list_of(gen_opts)
  end

  defp create_table_opts(opts) do
    fk? = Keyword.get(opts, :foreign_keys, true)

    fixed_map(%{
      pk: member_of([:column, :table]),
      fk: if(fk?, do: member_of([:column, :table]), else: constant(:none))
    })
  end

  def columns(column_list, table_opts, opts) do
    column_list
    |> Enum.map(fn {name, type, flags} -> column(name, type, flags, table_opts, opts) end)
    |> fixed_list()
  end

  def index_parameters(_column, columns) do
    # TODO: remove the current column from the list
    cols = Enum.take_random(columns, 1)

    one_of([
      nil,
      fixed_list(
        Enum.concat([
          [constant(" INCLUDE (")],
          Enum.intersperse(Enum.map(cols, &constant/1), constant(", ")),
          constant(")")
        ])
      )
    ])
  end

  def alter_table(opts \\ []) do
    bind_filter(
      existing_table(Keyword.put(opts, :quoted, false)),
      fn
        %{columns: []} ->
          # dont try to run alter table on table with no columns
          :skip

        table ->
          {:cont,
           stmt([
             "ALTER TABLE",
             optional("IF EXISTS"),
             optional("ONLY"),
             stmt([
               quote_table_name(table),
               one_of([
                 alter_action(table, opts),
                 alter_rename(table, opts)
               ])
             ])
           ])}
      end
    )
  end

  defp alter_action(table, opts) do
    one_of(
      [
        alter_add_column(table, opts),
        alter_drop_column(table, opts),
        alter_modify_column(table, opts)
      ]
      |> Enum.reject(&is_nil/1)
    )
  end

  defp alter_add_column(table, opts) do
    type =
      case Keyword.get(opts, :types) do
        types when is_list(types) -> member_of(types)
        _ -> datatype()
      end

    stmt([
      "ADD",
      optional("COLUMN"),
      optional("IF NOT EXISTS"),
      bind(tuple({name(), type}), fn {name, type} ->
        column(name, type, %{}, Keyword.put(opts, :owning_table, table))
      end)
    ])
  end

  defp alter_drop_column(table, opts) do
    case table do
      %{columns: []} ->
        nil

      table ->
        bind(member_of(table.columns), fn {column_name, _type, _flags} ->
          stmt([
            "DROP",
            optional("COLUMN"),
            optional("IF EXISTS"),
            quote_table_name(column_name),
            cascade?(opts)
          ])
        end)
    end
  end

  defp alter_modify_column(table, opts) do
    exceptions = Keyword.get(opts, :except, [])

    bind(member_of(table.columns), fn {name, _type, _flags} = column ->
      stmt([
        "ALTER",
        optional("COLUMN"),
        quote_table_name(name),
        one_of(
          [
            if(:set_type in exceptions, do: nil, else: alter_retype_column(opts)),
            alter_set_default(column, opts),
            alter_drop_default(opts),
            if(:drop_not_null in exceptions, do: nil, else: alter_set_null(opts)),
            if(:generated in exceptions, do: nil, else: alter_generated(opts))
          ]
          |> Enum.reject(&is_nil/1)
        )
      ])
    end)
  end

  defp alter_retype_column(opts) do
    type =
      case Keyword.get(opts, :types) do
        types when is_list(types) -> member_of(types)
        _ -> datatype()
      end

    bind(type, fn {_, type} ->
      stmt([optional("SET DATA"), "TYPE", type])
    end)
  end

  defp alter_set_default({_name, type, _flags}, opts) do
    bind(constant(type), fn {class, type} ->
      stmt([
        "SET DEFAULT",
        default_value(class, type, opts)
      ])
    end)
  end

  defp alter_drop_default(_opts) do
    constant("DROP DEFAULT")
  end

  defp alter_set_null(_opts) do
    # FIXME: we shouldn't drop not null of primary key columns -- easier to exclude this clause
    stmt([
      member_of(["SET", "DROP"]),
      "NOT NULL"
    ])
  end

  defp alter_generated(_opts) do
    one_of([
      stmt(["DROP EXPRESSION", optional("IF EXISTS")]),
      # stmt([constant("ADD GENERATED"), member_of(["ALWAYS", "BY DEFAULT"])])
      stmt(["DROP IDENTITY", member_of([nil, "IF EXISTS"])]),
      stmt(["SET STATISTICS", int(1..1000)]),
      stmt(["SET STORAGE", member_of(["PLAIN", "EXTERNAL", "EXTENDED", "MAIN"])]),
      stmt(["SET COMPRESSION", member_of(["pglz", "lz4"])])
    ])
  end

  defp alter_rename(table, opts) do
    one_of(
      [
        alter_rename_column(table, opts),
        alter_rename_constraint(table, opts),
        alter_constraint(table, opts),
        alter_rename_table(table, opts)
      ]
      |> Enum.reject(&is_nil/1)
    )
  end

  defp alter_rename_column(table, _opts) do
    bind(member_of(table.columns), fn {column_name, _type, _flags} ->
      stmt([
        "RENAME",
        member_of([nil, "COLUMN"]),
        quote_table_name(column_name),
        "TO",
        name()
      ])
    end)
  end

  defp alterable_constraints(%Table{} = table) do
    table.constraints
    |> Keyword.take([:foreign, :unique])
    |> Keyword.values()
  end

  defp alter_constraint(table, opts) do
    # the rules around deferrable and immediate are complicated, so allow for turning
    # them off when writing to the db
    if :alter_constraint in Keyword.get(opts, :except, []) do
      nil
    else
      case table do
        %{constraints: []} ->
          nil

        %{constraints: _constraints} ->
          case alterable_constraints(table) do
            [] ->
              nil

            constraints ->
              constraints
              |> safe_member_of()
              |> bind(fn {constraint_name, _cols} ->
                stmt([
                  "ALTER CONSTRAINT",
                  quote_table_name(constraint_name),
                  one_of([
                    member_of(["DEFERRABLE", "NOT DEFERRABLE"]),
                    member_of(["INITIALLY DEFERRED", "INITIALLY IMMEDIATE"])
                  ])
                ])
              end)
          end
      end
    end
  end

  defp alter_rename_constraint(table, _opts) do
    case table do
      %{constraints: []} ->
        nil

      %{constraints: constraints} ->
        constraints
        |> Keyword.values()
        |> member_of()
        |> bind(fn {constraint_name, _cols} ->
          stmt(["RENAME CONSTRAINT", quote_table_name(constraint_name), "TO", name()])
        end)
    end
  end

  defp alter_rename_table(_table, _opts) do
    stmt(["RENAME TO", name()])
  end

  def drop_table(opts \\ []) do
    name_generator =
      case Keyword.get(opts, :schema) do
        nil ->
          frequency([
            {4, name()},
            {1,
             uniq_list_of(name(), min_length: 1, max_length: 4)
             |> map(fn n -> Enum.join(n, ", ") end)}
          ])

        %Proto.Schema{} = schema ->
          schema.tables
          |> Enum.map(&quote_table_name(&1.name))
          |> member_of()
      end

    bind(name_generator, fn table_name ->
      stmt([
        "DROP TABLE",
        optional("IF EXISTS"),
        table_name,
        cascade?(opts)
      ])
    end)
  end

  defp cascade?(opts) do
    if Keyword.get(opts, :cascade, false) do
      constant("CASCADE")
    else
      optional(["CASCADE", "RESTRICT"])
    end
  end
end
