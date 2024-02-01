defmodule Electric.Postgres.Schema do
  alias Electric.Postgres.Schema.Proto
  alias Electric.Postgres.Replication
  alias PgQuery, as: Pg

  require Logger

  import Electric.Postgres.Extension, only: [is_extension_relation: 1]
  import Electric.Postgres.Schema.Proto, only: [is_unique_constraint: 1]

  @public_schema "public"
  @search_paths [nil, @public_schema]

  @type t() :: %Proto.Schema{}

  @type mbinary() :: String.t() | nil
  @type schema() :: mbinary()
  @type namespaced_name() :: {schema(), String.t()}
  @type name() ::
          String.t() | namespaced_name() | [mbinary()] | %Pg.RangeVar{} | %Proto.RangeVar{}

  def new do
    %Proto.Schema{}
  end

  defdelegate update(schema, cmds, opts), to: __MODULE__.Update, as: :apply_stmt

  def table_names(%Proto.Schema{} = schema) do
    Enum.map(schema.tables, fn %{name: name} ->
      to_string(name)
    end)
  end

  def name(%{name: name}) when is_binary(name) do
    name(name)
  end

  # don't double quote things
  def name("\"" <> _rest = name) when is_binary(name) do
    name
  end

  def name(name) when is_binary(name) do
    "\"" <> name <> "\""
  end

  def num_electrified_tables(schema) do
    Enum.count(schema.tables, fn %{name: name} ->
      not is_extension_relation({name.schema, name.name})
    end)
  end

  def indexes(schema, opts \\ []) do
    include_constraints? = Keyword.get(opts, :include_constraints, true)

    Enum.flat_map(schema.tables, fn table ->
      table.indexes ++ constraints_to_indexes(table, include_constraints?)
    end)
    |> order()
  end

  defp constraints_to_indexes(_table, false) do
    []
  end

  defp constraints_to_indexes(table, true) do
    Enum.flat_map(table.constraints, fn
      # TODO: exclude constraints that reference an index explicitly
      %{constraint: {_, constraint}} = c when is_unique_constraint(c) ->
        [
          %Proto.Index{
            name: constraint.name,
            table: table.name,
            unique: true,
            including: constraint.including,
            columns: Enum.map(constraint.keys, &%Proto.Index.Column{name: &1})
          }
        ]

      _ ->
        []
    end)
  end

  def fetch_table!(schema, name) do
    case fetch_table(schema, name) do
      {:ok, table} -> table
      {:error, reason} -> raise ArgumentError, message: reason
    end
  end

  def fetch_table(schema, name) do
    with %_{} = table <-
           Enum.find(
             schema.tables,
             {:error, "Unknown table #{inspect(name)}"},
             &equal?(&1.name, name)
           ) do
      {:ok, table}
    end
  end

  def lookup_oid(schema, oid) when is_integer(oid) do
    with %_{} = table <- Enum.find(schema.tables, :error, &(&1.oid == oid)) do
      {:ok, table}
    end
  end

  @spec primary_keys(t(), name(), name()) :: {:ok, [name()]} | {:error, any()}
  def primary_keys(schema, sname, tname) do
    with {:ok, table} <- fetch_table(schema, {sname, tname}) do
      primary_keys(table)
    end
  end

  @spec primary_keys(%Proto.Table{}) :: {:ok, [name()]} | {:error, any()}
  def primary_keys(%Proto.Table{} = table) do
    pk =
      Enum.find_value(table.constraints, nil, fn
        %Proto.Constraint{constraint: {:primary, pk}} ->
          pk

        _ ->
          false
      end)

    if pk do
      {:ok, pk.keys}
    else
      {:error, "table #{table.name} has no primary key constraint"}
    end
  end

  @doc """
  Build a directed graph of foreign key relations of public tables for the given schema.

  Graph vertices are table names, and graph edges go from the table with the
  foreign key to the referenced table. Each edge is labeled with an array of
  columns that comprise the foreign key.
  """
  @spec public_fk_graph(t()) :: Graph.t()
  def public_fk_graph(%Proto.Schema{tables: tables}) do
    graph =
      tables
      |> Enum.map(&{&1.name.schema, &1.name.name})
      |> then(&Graph.add_vertices(Graph.new(), &1))

    Enum.reduce(tables, graph, fn %Proto.Table{constraints: constraints, name: name}, graph ->
      constraints
      |> Enum.filter(&match?(%{constraint: {:foreign, _}}, &1))
      |> Enum.map(fn %{constraint: {:foreign, fk}} ->
        {{name.schema, name.name}, {fk.pk_table.schema, fk.pk_table.name}, label: fk.fk_cols}
      end)
      |> then(&Graph.add_edges(graph, &1))
    end)
  end

  @spec lookup_enum_values([%Proto.Enum{}], String.t()) :: [String.t()] | nil
  def lookup_enum_values(enums, typename) do
    Enum.find(enums, fn %{name: name} ->
      qualified_name = name.schema <> "." <> name.name

      typename == qualified_name or
        (name.schema == @public_schema and typename == name.name)
    end)
    |> case do
      nil -> nil
      enum -> enum.values
    end
  end

  @doc """
  Look up a table in the schema and return replication information about it.
  """
  @spec table_info(t(), {name(), name()}) ::
          {:ok, Replication.Table.t()} | {:error, term()}
  def table_info(schema, {sname, tname}) do
    table_info(schema, sname, tname)
  end

  @spec table_info(t(), integer()) :: {:ok, Replication.Table.t()} | {:error, term()}
  def table_info(schema, oid) when is_integer(oid) do
    with {:ok, table} <- lookup_oid(schema, oid) do
      {:ok, single_table_info(table, schema)}
    end
  end

  @spec table_info(t(), name(), name()) :: {:ok, Replication.Table.t()} | {:error, term()}
  def table_info(schema, sname, tname) when is_binary(sname) and is_binary(tname) do
    with {:ok, table} <- fetch_table(schema, {sname, tname}) do
      {:ok, single_table_info(table, schema)}
    end
  end

  @doc """
  Return replication information for a single table or all tables in the schema.
  """
  @spec table_info(t()) :: [Replication.Table.t()]
  def table_info(%Proto.Schema{} = schema) do
    for table <- schema.tables, do: single_table_info(table, schema)
  end

  @spec single_table_info(%Proto.Table{}, t) :: Replication.Table.t()
  def single_table_info(%Proto.Table{} = table, schema) do
    {:ok, pks} = primary_keys(table)

    columns =
      for col <- table.columns do
        %Replication.Column{
          name: col.name,
          type: col_type(col.type, schema.enums),
          nullable?: col_nullable?(col),
          type_modifier: List.first(col.type.size, -1),
          # since we're using replication identity "full" all columns
          # are identity columns in replication terms
          part_of_identity?: true
        }
      end

    table_info = %Replication.Table{
      schema: table.name.schema,
      name: table.name.name,
      oid: table.oid,
      primary_keys: pks,
      replica_identity: :all_columns,
      columns: columns
    }

    table_info
  end

  defp col_type(%{name: name, array: [_ | _]}, enums), do: {:array, col_type(name, enums)}
  defp col_type(%{name: name}, enums), do: col_type(name, enums)

  defp col_type("serial2", _enums), do: :int2
  defp col_type(t, _enums) when t in ["serial", "serial4"], do: :int4
  defp col_type("serial8", _enums), do: :int8

  defp col_type(t, enums) do
    if lookup_enum_values(enums, t) do
      t
    else
      String.to_atom(t)
    end
  end

  defp col_nullable?(col) do
    col.constraints
    |> Enum.find(&match?(%Proto.Constraint{constraint: {:not_null, _}}, &1))
    |> is_nil()
  end

  # want table constraint order to be constistent so that we can verify the in-memory schema with
  # that held by a pg instance.  this means re-sorting the table (or column) constraints after
  # every modification
  def constraint_order(list) do
    struct_order(list)
  end

  def order(list) do
    struct_order(list)
  end

  def struct_order(list) do
    Enum.sort(list)
  end

  @namedatalen 63

  defguardp is_name(n) when is_binary(n) and n not in [nil, ""]

  def constraint_name(name, _table_name, _keys, _type) when is_name(name) do
    truncate(name, @namedatalen)
  end

  # https://stackoverflow.com/questions/4107915/postgresql-default-constraint-names
  # pkeys on include the table name - you can only have one right!
  def constraint_name(_empty, table_name, _keys, "pkey") do
    make_object_name(table_name, nil, "pkey")
  end

  def constraint_name(_empty, table_name, [], type) do
    make_object_name(table_name, nil, type)
  end

  def constraint_name(_empty, table_name, keys, type) do
    k = Enum.join(List.wrap(keys), "_")
    make_object_name(table_name, k, type)
  end

  # make_object_name is a copy of `makeObjectName` in the pg source:
  # src/backend/commands/indexcmds.c
  defp make_object_name(name1, empty, label) when empty in [nil, ""] do
    n = truncate(name1, @namedatalen - byte_size(label) - 1)
    "#{n}_#{label}"
  end

  defp make_object_name(name1, name2, label) do
    # include _ between name1 and name2 and between name and label
    overhead = byte_size(label) + 2
    availchars = @namedatalen - overhead
    name1chars = byte_size(name1)
    name2chars = byte_size(name2)
    {name1chars, name2chars} = shorten(name1chars, name2chars, availchars)
    "#{truncate(name1, name1chars)}_#{truncate(name2, name2chars)}_#{label}"
  end

  defp shorten(name1chars, name2chars, availchars) do
    if name1chars + name2chars > availchars do
      if name1chars > name2chars do
        shorten(name1chars - 1, name2chars, availchars)
      else
        shorten(name1chars, name2chars - 1, availchars)
      end
    else
      {name1chars, name2chars}
    end
  end

  defp truncate(n, len) when byte_size(n) <= len do
    n
  end

  defp truncate(n, len) do
    binary_part(n, 0, len)
  end

  @spec equal?(name(), name()) :: boolean
  def equal?(n1, n2, search_paths \\ @search_paths) do
    Enum.any?(qualified_names(n1, search_paths), fn n1 ->
      Enum.any?(qualified_names(n2, search_paths), fn n2 ->
        n1 == n2
      end)
    end)
  end

  @spec search_schemas(binary | nil, [binary | nil]) :: [binary | nil]
  def search_schemas(s, search_paths \\ @search_paths)

  def search_schemas(s, search_paths) when s in [nil, ""] do
    search_paths
  end

  def search_schemas(s, search_paths) do
    if s in search_paths, do: search_paths, else: [s | search_paths]
  end

  def same_schema?(s1, s2, search_paths \\ @search_paths)

  def same_schema?(s, s, _search_paths) do
    true
  end

  def same_schema?(s1, s2, _search_paths) when s1 in ["", nil] and s2 in ["", nil] do
    true
  end

  def same_schema?(s1, s2, search_paths) when s1 in ["", nil] do
    s2 in search_paths
  end

  def same_schema?(s1, s2, search_paths) when s2 in ["", nil] do
    s1 in search_paths
  end

  def same_schema?(s1, s2, _search_paths) when is_binary(s1) and is_binary(s2) do
    s1 == s2
  end

  defp qualified_names(n, search_paths) when is_binary(n) do
    Enum.map(search_paths, &{&1, n})
  end

  defp qualified_names({blank, n}, search_paths) when blank in [nil, ""] and is_binary(n) do
    Enum.map(search_paths, &{&1, n})
  end

  # if the name has an explicit schema then don't try the search paths
  defp qualified_names({s, n}, _search_paths) when is_binary(s) and is_binary(n) do
    [{s, n}]
  end

  defp qualified_names([s, n], search_paths) do
    qualified_names({s, n}, search_paths)
  end

  defp qualified_names(%Proto.RangeVar{name: n, schema: s}, search_paths) do
    qualified_names({blank(s), n}, search_paths)
  end

  defp qualified_names(%Pg.RangeVar{relname: n, schemaname: s}, search_paths) do
    qualified_names({blank(s), n}, search_paths)
  end

  defp blank(nil), do: nil
  defp blank(""), do: nil
  defp blank(s) when is_binary(s), do: s

  @doc """
  Retrieve the given oid loader function from function opts and validate that
  it's a 3-arity function.
  """
  @spec verify_oid_loader!(Keyword.t()) ::
          (:index | :table | :trigger | :view, schema :: binary(), name :: binary() ->
             {:ok, integer()})
  def verify_oid_loader!(opts) when is_list(opts) do
    case Keyword.fetch(opts, :oid_loader) do
      {:ok, loader} when is_function(loader, 3) ->
        loader

      {:ok, _loader} ->
        raise ArgumentError,
          message:
            "`:oid_loader` should be an arity-3 function (type :: :index | :table | :trigger | :view, schema :: binary(), name :: binary()) -> {:ok, integer()}"

      :error ->
        raise ArgumentError,
          message: "missing `:oid_loader` option"
    end
  end

  @doc """
  Enrich the schema with shadow tables for each table.

  We don't check if the shadow tables actually exist, so only electrified
  tables (or other tables that are expected to have shadows) should be included
  in the schema passed to this function
  """
  def add_shadow_tables(%Proto.Schema{tables: tables} = schema, opts) do
    oid_loader = verify_oid_loader!(opts)
    normal_tables = Enum.reject(tables, &is_shadow_table?/1)

    shadow_tables =
      Enum.map(normal_tables, &build_shadow_table(&1, oid_loader))

    %{schema | tables: normal_tables ++ shadow_tables}
  end

  @schema Electric.Postgres.Extension.schema()
  defp is_shadow_table?(%Proto.Table{
         name: %Proto.RangeVar{schema: @schema, name: "shadow__" <> _}
       }),
       do: true

  defp is_shadow_table?(%Proto.Table{}), do: false

  @electric_tag_type %Proto.Column.Type{
    name: "electric.tag",
    size: [],
    array: []
  }

  # These are missing their DEFAULT constraints, but I don't think it matters
  #   _tags electric.tag[] DEFAULT array[]::electric.tag[],
  #   _last_modified bigint,
  #   _is_a_delete_operation boolean DEFAULT false,
  #   _tag electric.tag,
  #   _observed_tags electric.tag[],
  #   _modified_columns_bit_mask boolean[],
  #   _resolved boolean,
  #   _currently_reordering boolean
  @shadow_columns [
    %Proto.Column{name: "_tags", type: %Proto.Column.Type{name: "electric.tag", array: [-1]}},
    %Proto.Column{name: "_last_modified", type: %Proto.Column.Type{name: "int8"}},
    %Proto.Column{name: "_is_a_delete_operation", type: %Proto.Column.Type{name: "bool"}},
    %Proto.Column{name: "_tag", type: %Proto.Column.Type{name: "electric.tag"}},
    %Proto.Column{
      name: "_observed_tags",
      type: %Proto.Column.Type{name: "electric.tag", array: [-1]}
    },
    %Proto.Column{
      name: "_modified_columns_bit_mask",
      type: %Proto.Column.Type{name: "bool", array: [-1]}
    },
    %Proto.Column{name: "_resolved", type: %Proto.Column.Type{name: "bool"}},
    %Proto.Column{name: "_currently_reordering", type: %Proto.Column.Type{name: "bool"}}
  ]

  defp build_shadow_table(%Proto.Table{} = main, oid_loader) do
    # The columns based on the main table lack any defaults/constraints on shadow tables
    stripped_columns = Enum.map(main.columns, &Map.put(&1, :constraints, []))
    {:ok, pk_column_names} = primary_keys(main)

    {pks, non_pks} = Enum.split_with(stripped_columns, &(&1.name in pk_column_names))

    timestamps =
      non_pks
      |> Enum.map(&Map.put(&1, :type, @electric_tag_type))
      |> Enum.map(&Map.update!(&1, :name, fn n -> String.slice("_tag_#{n}", 0..63) end))

    reordered =
      Enum.map(
        non_pks,
        &Map.update!(&1, :name, fn n -> String.slice("__reordered_#{n}", 0..63) end)
      )

    {schema, table_name} = shadow_table_name(main.name.schema, main.name.name)

    {:ok, oid} = oid_loader.(:table, @schema, table_name)

    %Proto.Table{
      oid: oid,
      name: %Proto.RangeVar{
        schema: schema,
        name: table_name
      },
      columns: pks ++ @shadow_columns ++ timestamps ++ reordered,
      constraints: Enum.filter(main.constraints, &match?(%{constraint: {:primary, _}}, &1)),
      indexes: []
    }
  end

  @doc """
  Returns the schema and name of the shadow table for the given table.
  """
  @spec shadow_table_name(name(), name()) :: namespaced_name()
  def shadow_table_name(schema, table) do
    {@schema, "shadow__#{schema}__#{table}"}
  end

  @doc """
  Returns the schema and name of the tombstone table for the given table.
  """
  @spec tombstone_table_name(name(), name()) :: namespaced_name()
  def tombstone_table_name(schema, table) do
    {@schema, "tombstone__#{schema}__#{table}"}
  end
end
