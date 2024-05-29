defmodule Electric.Postgres.Schema.FkGraph do
  @moduledoc """
  Handles foreign key lookups and fk graph following.

  Splits path following from fk lookup because for the path following we don't want the
  directionality of a directed graph - we need to follow relations across e.g. join tables where
  the fks point against the flow of the graph.

  So we use an undirected graph for the path traversal and keep the directionality of the foreign
  key relations in a separate map of `%{relation() => %{relation() => [column_name()]}}`.
  """
  alias Electric.Postgres.Schema.Proto
  alias Electric.Postgres.Extension.SchemaLoader

  defstruct [:directed, :undirected, fks: %{}, pks: %{}]

  @type relation() :: Electric.Postgres.relation()
  @type name() :: Electric.Postgres.name()
  @type fks() :: [name(), ...]
  @type pks() :: [name(), ...]
  @type join() ::
          {:many_to_one, {relation(), fks()}, {relation(), pks()}}
          | {:one_to_many, {relation(), pks()}, {relation(), fks()}}

  @type t() :: %__MODULE__{
          directed: Graph.t(),
          undirected: Graph.t(),
          fks: %{relation() => %{relation() => fks()}},
          pks: %{relation() => pks()}
        }
  @type edge() :: {relation(), relation(), label: fks()} | {relation(), relation(), fks()}
  @type path() :: [relation(), ...]

  @spec for_schema(SchemaLoader.Version.t()) :: t()
  def for_schema(%SchemaLoader.Version{schema: schema}) do
    for_schema(schema)
  end

  @spec for_schema(%Proto.Schema{}) :: t()
  def for_schema(%Proto.Schema{tables: tables}) do
    fks =
      for %Proto.Table{constraints: constraints, name: name} <- tables,
          %{constraint: {:foreign, fk}} <- constraints do
        {{name.schema, name.name}, {fk.pk_table.schema, fk.pk_table.name}, fk.fk_cols}
      end

    pks =
      for %Proto.Table{constraints: constraints, name: name} <- tables,
          %{constraint: {:primary, pk}} <- constraints,
          into: %{} do
        {{name.schema, name.name}, pk.keys}
      end

    new(fks, pks)
  end

  defp new_graph(type) do
    Graph.new(type: type, vertex_identifier: & &1)
  end

  @spec new([edge()], %{relation() => pks()}) :: t()
  def new(edges, pks) do
    {directed, undirected, fks} =
      edges
      |> Enum.reduce(
        {new_graph(:directed), new_graph(:undirected), %{}},
        fn edge, {directed, undirected, fks} ->
          {v1, v2, fk_cols} = normalise_edge(edge)

          {
            Graph.add_edge(directed, v1, v2),
            Graph.add_edge(undirected, v1, v2),
            Map.update(fks, v1, %{v2 => fk_cols}, fn relations ->
              Map.put(relations, v2, fk_cols)
            end)
          }
        end
      )

    %__MODULE__{directed: directed, undirected: undirected, fks: fks, pks: pks}
  end

  defp normalise_edge({{_, _} = v1, {_, _} = v2, label: fk_columns}) when is_list(fk_columns) do
    {v1, v2, fk_columns}
  end

  defp normalise_edge({{_, _} = v1, {_, _} = v2, fk_columns}) when is_list(fk_columns) do
    {v1, v2, fk_columns}
  end

  @spec has_relation?(t(), relation()) :: boolean()
  def has_relation?(%__MODULE__{pks: pks}, {_, _} = relation) do
    Map.has_key?(pks, relation)
  end

  @doc """
  Return all foreign keys on the table `relation`.
  """
  @spec foreign_keys(t(), relation()) :: %{relation() => fks()}
  def foreign_keys(%__MODULE__{fks: fks}, {_, _} = relation) do
    Map.get(fks, relation, %{})
  end

  @doc """
  Give the foreign keys on table `relation` that place it in the scope defined by `root`.
  """
  @spec foreign_keys(t(), relation(), relation()) :: fks() | nil
  # [VAX-1626] we don't support recursive relations
  def foreign_keys(%__MODULE__{}, {_, _} = root, root) do
    []
  end

  def foreign_keys(%__MODULE__{fks: fks} = fk_graph, {_, _} = root, {_, _} = relation) do
    # we guard against looking for a fk ref to the same table above so relation_path/3 is always
    # going to return a list of at least 2 items or nil if there is no route between the two
    # tables

    with [r1 | _] <- path(fk_graph, root, relation) || [] do
      table_fks = Map.get(fks, r1, %{})
      # this gives us a list of the fks pointing out of this table
      # we now need to find which of those live within the `root` scope
      Enum.filter(table_fks, fn {fk_relation, _fk_cols} ->
        is_list(path(fk_graph, root, fk_relation))
      end)
    end
  end

  @doc """
  Get the shortest path between two relations.
  """
  @spec path(t(), root :: relation(), target :: relation()) :: path() | nil
  def path(%__MODULE__{}, {_, _} = root, root) do
    [root]
  end

  def path(%__MODULE__{undirected: undirected}, {_, _} = root, {_, _} = relation) do
    Graph.get_shortest_path(undirected, relation, root)
  end

  @type step() :: {:one_to_many, relation()} | {:many_to_one, relation()} | {:root, relation()}
  @type route() :: [step()]

  @doc """
  Finds all the possible paths from the `target` table to the `root` table, coping with
  one-to-many and many-to-one relations in the schema.

  Each path segment is labeled with the join type to the next segment, either `:many_to_one` or
  `:one_to_many`, with the final entry, which will be the `root` labelled as `:root`
  """
  @spec routes(t(), relation(), relation()) :: [route()]
  def routes(%__MODULE__{}, {_, _} = root, {_, _} = root) do
    [[{:root, root}]]
  end

  def routes(%__MODULE__{directed: directed}, {_, _} = root, {_, _} = relation) do
    Enum.concat(
      Graph.get_paths(directed, relation, root) |> Enum.map(&label_path(&1, :many_to_one)),
      recurse_paths([], directed, root, relation, relation)
    )
  end

  defp recurse_all_paths(graph, root, relation, start) do
    graph
    |> Graph.get_paths(relation, root)
    |> recurse_paths(graph, root, relation, start)
  end

  defp recurse_paths([], graph, root, relation, start) do
    # there are no paths from the relation to the root, so see if we can find paths from any
    # relations that are pointing to us, that is a one-to-many type relation

    graph
    |> Graph.in_edges(relation)
    |> Enum.flat_map(&recurse_all_paths(graph, root, &1.v1, start))
    |> Enum.map(&[{:one_to_many, relation} | &1])
  end

  defp recurse_paths(paths, _graph, root, _relation, start) do
    Enum.filter(paths, fn path ->
      match?([^root | _], Enum.reverse(path)) && !Enum.member?(path, start)
    end)
    |> Enum.map(&label_path(&1, :many_to_one))
  end

  defp label_path([relation], _label) do
    [{:root, relation}]
  end

  defp label_path([relation | path], label) do
    [{label, relation} | label_path(path, label)]
  end

  @doc """
  Given the two tables `source` and `target` describe the fk relation between them, either
  `:many_to_one` or `:one_to_many`.

  - `{:many_to_one, {from_table, foreign_key_columns}, {to_table, primary_key_columns}}`, or
  - `{:one_to_many, {from_table, primary_key_columns}, {to_table, foreign_key_columns}}`
  """
  @spec fetch_join_type(t(), relation(), relation()) :: {:ok, join()} | :error
  def fetch_join_type(%__MODULE__{fks: fks, pks: pks}, {_, _} = source, {_, _} = target) do
    case fks do
      %{^source => %{^target => fks}} ->
        {:ok, {:many_to_one, {source, fks}, {target, Map.fetch!(pks, target)}}}

      %{^target => %{^source => fks}} ->
        {:ok, {:one_to_many, {source, Map.fetch!(pks, source)}, {target, fks}}}

      _ ->
        :error
    end
  end

  @doc """
  Return the primary key columns for the given relation.
  """
  @spec primary_keys(t(), relation()) :: {:ok, pks()} | :error
  def primary_keys(%__MODULE__{pks: pks}, {_, _} = table) do
    Map.fetch(pks, table)
  end
end
