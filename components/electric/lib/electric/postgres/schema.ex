defmodule Electric.Postgres.Schema do
  defstruct tables: [], indexes: [], triggers: [], views: []

  alias Electric.Postgres.Schema.Proto
  alias PgQuery, as: Pg

  require Logger

  import Electric.Postgres.Schema.Proto, only: [is_unique_constraint: 1]

  @search_paths [nil, "public"]

  @type t() :: %Proto.Schema{}

  @type mbinary() :: binary() | nil
  @type schema() :: mbinary()
  @type name() ::
          binary() | {schema(), binary()} | [mbinary()] | %Pg.RangeVar{} | %Proto.RangeVar{}

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
      :error -> raise ArgumentError, message: "Unknown table #{name}"
    end
  end

  def fetch_table(schema, name) do
    with %_{} = table <- Enum.find(schema.tables, :error, &equal?(&1.name, name)) do
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
    else
      :error -> {:error, "no such table #{inspect(sname)}.#{inspect(tname)}"}
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

  Only tables known to Satellite are included (currently, this means only in the `public` schema).
  """
  @spec public_fk_graph(t()) :: Graph.t()
  def public_fk_graph(%Proto.Schema{tables: tables}) do
    graph =
      tables
      |> Enum.filter(&(&1.name.schema == "public"))
      |> Enum.map(& &1.name.name)
      |> then(&Graph.add_vertices(Graph.new(), &1))

    Enum.reduce(tables, graph, fn %Proto.Table{constraints: constraints, name: name}, graph ->
      constraints
      |> Enum.filter(&match?(%{constraint: {:foreign, _}}, &1))
      |> Enum.map(fn %{constraint: {:foreign, fk}} ->
        {name.name, fk.pk_table.name, label: fk.fk_cols}
      end)
      |> then(&Graph.add_edges(graph, &1))
    end)
  end

  @spec table_info(%Proto.Table{}) :: {:ok, Electric.Postgres.Replication.Table.t()}
  def table_info(%Proto.Table{} = table) do
    {:ok, pks} = primary_keys(table)

    columns =
      for col <- table.columns do
        %Electric.Postgres.Replication.Column{
          name: col.name,
          type: col_type(col.type),
          type_modifier: List.first(col.type.size, -1),
          identity?: col.name in pks
        }
      end

    table_info = %Electric.Postgres.Replication.Table{
      schema: table.name.schema,
      name: table.name.name,
      oid: table.oid,
      primary_keys: pks,
      replica_identity: :index,
      columns: columns
    }

    {:ok, table_info}
  end

  defp col_type(%{name: name, array: [_]}), do: {:array, col_type(name)}
  defp col_type(%{name: name}), do: col_type(name)

  defp col_type("serial2"), do: :int2
  defp col_type(t) when t in ["serial", "serial4"], do: :int4
  defp col_type("serial8"), do: :int8
  defp col_type(t) when is_binary(t), do: String.to_atom(t)

  def struct_order(list) do
    Enum.sort(list)
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
  Enrich the schema with shadow tables for each table.

  We don't check if the shadow tables actually exist, so only electrified
  tables (or other tables that are expected to have shadows) should be included
  in the schema passed to this function
  """
  def add_shadow_tables(%Proto.Schema{tables: tables} = schema) do
    shadow_tables =
      tables
      |> Enum.reject(&is_shadow_table?/1)
      |> Enum.map(&build_shadow_table/1)

    %{schema | tables: tables ++ shadow_tables}
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

  defp build_shadow_table(%Proto.Table{} = main) do
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

    %Proto.Table{
      # `MigrationConsumer` code currently has logic that for any incoming relation, we're the OID already in the `SchemaRegistry`.
      # Hence, we just need any oid that's not going to collide. `oid` type is uint4, with max being 4,294,967,295.
      # Let's add 2,000,000,000 to original table oid and hope for the best.
      # OID generation is done on PG side by an increasing counter [1] and not a random value,
      # and that counter functionally starts at 16384 [2]. I think that starting our "fake" oid generation near the end,
      # with it only being required to not conflict within one table (`pg_class`) seems fine for now.
      #
      # TODO: Add more robust checks to definitely not collide in our own SchemaRegistry or alternatives.
      oid: 2_000_000_000 + main.oid,
      name: %Proto.RangeVar{
        schema: @schema,
        name: "shadow__#{main.name.schema}__#{main.name.name}"
      },
      columns: pks ++ @shadow_columns ++ timestamps ++ reordered,
      constraints: Enum.filter(main.constraints, &match?(%{constraint: {:primary, _}}, &1)),
      indexes: []
    }
  end
end
