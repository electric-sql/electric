defmodule Electric.Postgres.Schema do
  defstruct tables: [], indexes: [], triggers: [], views: []

  alias Electric.Postgres.Schema.Proto
  alias PgQuery, as: Pg

  require Logger

  import Electric.Postgres.Schema.Proto, only: [is_unique_constraint: 1]

  @search_paths [nil, "public"]

  @type t() :: %Proto.Schema{}

  def new do
    %Proto.Schema{}
  end

  defdelegate update(schema, cmds), to: __MODULE__.Update, as: :apply_stmt

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

  @type mbinary() :: binary() | nil
  @type schema() :: mbinary()
  @type name() ::
          binary() | {schema(), binary()} | [mbinary()] | %Pg.RangeVar{} | %Proto.RangeVar{}
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
end
