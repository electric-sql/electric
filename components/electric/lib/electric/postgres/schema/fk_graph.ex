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

  defstruct [:graph, fks: %{}, pks: %{}]

  @type relation() :: Electric.Postgres.relation()
  @type name() :: Electric.Postgres.name()
  @type fks() :: [name(), ...]
  @type pks() :: [name(), ...]
  @type join() ::
          {:many_to_one, {relation(), fks()}, {relation(), pks()}}
          | {:one_to_many, {relation(), pks()}, {relation(), fks()}}

  @type t() :: %__MODULE__{
          graph: Graph.t(),
          fks: %{relation() => %{relation() => fks()}},
          pks: %{relation() => pks()}
        }
  @type edge() :: {relation(), relation(), label: fks()} | {relation(), relation(), fks()}

  @spec for_schema(SchemaLoader.Version.t()) :: t()
  def for_schema(%SchemaLoader.Version{schema: schema}) do
    for_schema(schema)
  end

  def for_schema(%Proto.Schema{tables: tables}) do
    fks =
      tables
      |> Enum.flat_map(fn %Proto.Table{constraints: constraints, name: name} ->
        constraints
        |> Stream.filter(&match?(%{constraint: {:foreign, _}}, &1))
        |> Enum.map(fn %{constraint: {:foreign, fk}} ->
          {{name.schema, name.name}, {fk.pk_table.schema, fk.pk_table.name}, fk.fk_cols}
        end)
      end)

    pks =
      tables
      |> Stream.flat_map(fn %Proto.Table{constraints: constraints, name: name} ->
        constraints
        |> Stream.filter(&match?(%{constraint: {:primary, _}}, &1))
        |> Enum.map(fn %{constraint: {:primary, pk}} ->
          {{name.schema, name.name}, pk.keys}
        end)
      end)
      |> Map.new()

    new(fks, pks)
  end

  defp new_graph do
    Graph.new(type: :undirected, vertex_identifier: & &1)
  end

  @spec new([edge()], %{relation() => pks()}) :: t()
  def new(edges, pks) do
    {graph, fks} =
      edges
      |> Enum.reduce({new_graph(), %{}}, fn edge, {graph, fks} ->
        {v1, v2, fk_cols} = normalise_edge(edge)

        {
          Graph.add_edge(graph, v1, v2),
          Map.update(fks, v1, %{v2 => fk_cols}, fn relations ->
            Map.put(relations, v2, fk_cols)
          end)
        }
      end)

    %__MODULE__{graph: graph, fks: fks, pks: pks}
  end

  defp normalise_edge({{_, _} = v1, {_, _} = v2, label: fk_columns}) when is_list(fk_columns) do
    {v1, v2, fk_columns}
  end

  defp normalise_edge({{_, _} = v1, {_, _} = v2, fk_columns}) when is_list(fk_columns) do
    {v1, v2, fk_columns}
  end

  @doc """
  Give the foreign keys on table `relation` that place it in the scope defined by `root`.
  """
  @spec foreign_keys(t(), relation(), relation()) :: fks() | nil
  # [VAX-1626] we don't support recursive relations
  def foreign_keys(%__MODULE__{}, {_, _} = root, root) do
    nil
  end

  def foreign_keys(%__MODULE__{fks: fks} = fk_graph, {_, _} = root, {_, _} = relation) do
    # we guard against looking for a fk ref to the same table above so relation_path/3 is always
    # going to return a list of at least 2 items or `nil` if there is no route between the two
    # tables

    with [r1 | _] <- path(fk_graph, root, relation),
         table_fks when is_map(table_fks) <- Map.get(fks, r1, nil) do
      # this gives us a list of the fks pointing out of this table
      # we now need to find which of those live within the `root` scope
      Enum.filter(table_fks, fn {fk_relation, _fk_cols} ->
        is_list(path(fk_graph, root, fk_relation))
      end)
    end
  end

  @doc """
  Get a relation path from the `target` table to the `root` table, defined by a foreign key
  constraints between all tables in the path.
  """
  @spec path(t(), root :: relation(), target :: relation()) :: [relation(), ...] | nil
  def path(%__MODULE__{}, {_, _} = root, root) do
    [root]
  end

  def path(%__MODULE__{graph: graph}, {_, _} = root, {_, _} = relation) do
    Graph.get_shortest_path(graph, relation, root)
  end

  @doc """
  Get the foreign key path information between the `root` table and the given `relation`.

  Each entry in the path is either
  - `{:many_to_one, {from_table, foreign_key_columns}, {to_table, primary_key_columns}}`, or
  - `{:one_to_many, {from_table, primary_key_columns}, {to_table, foreign_key_columns}}`

  depending on the relation between the two tables.
  """
  @spec fk_path(t(), relation(), relation()) :: [join()] | nil
  def fk_path(%__MODULE__{} = fk_graph, {_, _} = root, {_, _} = relation) do
    with [_ | _] = path <- path(fk_graph, root, relation) do
      path
      |> Enum.chunk_every(2, 1, :discard)
      |> Enum.map(fn [a, b] -> join(fk_graph, a, b) end)
    end
  end

  @doc """
  Given the two tables `source` and `target` describe the fk relation between them, either
  `:many_to_one` or `:one_to_many`.

  See `fk_path/3` above.
  """
  @spec join(t(), relation(), relation()) :: join()
  def join(%__MODULE__{fks: fks, pks: pks}, {_, _} = source, {_, _} = target) do
    cond do
      fks = get_in(fks, [source, target]) ->
        {:many_to_one, {source, fks}, {target, Map.fetch!(pks, target)}}

      fks = get_in(fks, [target, source]) ->
        {:one_to_many, {source, Map.fetch!(pks, source)}, {target, fks}}
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
