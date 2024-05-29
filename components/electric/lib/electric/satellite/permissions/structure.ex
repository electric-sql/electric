defmodule Electric.Satellite.Permissions.Structure do
  @moduledoc """
  Provides scope path, primary and foreign key information for permissions scope lookups.

  Adds context from the permissions definitions to the raw schema information in order to more
  correctly traverse scope hierarchies in the case of multiple paths through the table foreign
  keys.
  """

  alias Electric.Utils
  alias Electric.Postgres.Extension.SchemaLoader
  alias Electric.Postgres.Schema.FkGraph
  alias Electric.Replication.Changes
  alias Electric.Satellite.Permissions.Graph
  alias Electric.Satellite.SatPerms

  defstruct paths: %{}, fks: %{}, pks: %{}, scopes: [], fk_graph: nil

  import Electric.Postgres.Extension, only: [is_extension_relation: 1]

  @type relation() :: Electric.Postgres.relation()
  @type name() :: Electric.Postgres.name()
  @type col() :: Electric.Postgres.name()
  @type outbound_fks() :: %{relation() => %{relation() => [col()]}}
  @type inbound_fks() :: %{relation() => %{relation() => [{col(), col()}]}}
  @type t() :: %__MODULE__{
          paths: %{relation() => %{relation() => [relation()]}},
          fks: %{outbound: outbound_fks(), inbound: inbound_fks()},
          pks: %{relation() => [col()]},
          fk_graph: FkGraph.t(),
          scopes: [relation()]
        }

  # when looking for the best path, with the highest score,
  # we start with a very poor/-ve score so that the first real
  # score will always replace it.
  @worst_score -10_000

  @spec compile([%SatPerms.Assign{}], [%SatPerms.Grant{}], SchemaLoader.Version.t()) ::
          {:ok, t()} | {:error, String.t()}
  def compile(assigns, grants, schema_version) do
    graph = SchemaLoader.Version.fk_graph(schema_version)
    scoped_grants = scoped_only(grants)
    scoped_assigns = scoped_only(assigns)

    scope_tables =
      scoped_grants
      |> Enum.concat(scoped_assigns)
      |> Enum.reduce(%{}, fn {scope, table}, acc ->
        Map.update(
          acc,
          scope,
          MapSet.new([scope, table]),
          &MapSet.put(&1, table)
        )
      end)

    application_tables =
      Enum.flat_map(schema_version.tables, fn
        {electric, _} when is_extension_relation(electric) -> []
        {table, _} -> [table]
      end)

    # consider this fk graph. A references R, B references A and R
    #
    # R <- A <- B
    # └----<----┘
    #
    # we setup the permissions based on R:
    #
    # ELECTRIC ASSIGN 'owner' TO R.user_id;
    # ELECTRIC GRANT ALL ON A TO (R, 'owner')
    # ELECTRIC GRANT ALL ON B TO (R, 'owner')
    #
    # naively we can get a path from B to R just by following the foreign key on B, skipping A
    # completely, but that does not match the permissions design, which is based on the path
    # R <- A <- B. i.e. the grants explicitly place table A in the same permissions scope so
    # the path B -> A -> R is definitely "more" scope-like than B -> R.
    #
    # this module uses both the FK graph and the permissions configuration to ensure that the
    # scope lookup for table B goes through A.
    #
    # in the case above the two paths are (B, R) and (B, A, R).
    #
    # we want to find the path that is definitely within the defined scope we do this by
    # recognising that every table with grants that depend on the scope must be in the scope.
    #
    # TODO: [VAX-1822]
    # This is a heuristic that will fail with some schemas, the plan is to implement the `USING`
    # clause in GRANT statements so that the correct FK path for the scope (or even a path
    # without defined FK relations between the tables) can be used .
    paths =
      scope_tables
      |> Map.new(fn {scope, tables} ->
        {scope,
         Map.new(application_tables, fn table ->
           routes = FkGraph.routes(graph, scope, table)

           {
             table,
             routes
             |> Enum.filter(fn [{_, ^table} | path] ->
               Enum.all?(path, fn {_, table} -> MapSet.member?(tables, table) end)
             end)
             |> Enum.map(fn path ->
               # use the route information to score the paths through the fk graph
               # prefer many to one relations over one-to-many, as this is the most
               # likely configuration for a permissions scope.
               # TODO: replace with the `USING` clause in grants so ambiguous paths
               #       through the graph can be defined by the dev
               Enum.map_reduce(path, 0, fn
                 {:many_to_one, relation}, score -> {relation, score + 1}
                 {:one_to_many, relation}, score -> {relation, score - 1}
                 {:root, relation}, score -> {relation, score}
               end)
             end)
             |> Enum.reduce({[], @worst_score}, fn {path, score}, {_, max} = best ->
               if score > max, do: {path, score}, else: best
             end)
             |> case do
               {[], _} -> nil
               {path, _score} -> path
             end
           }
         end)}
      end)

    inbound_fks =
      for %{constraints: constraints, name: name} <- schema_version.schema.tables,
          %{constraint: {:foreign, fk}} <- constraints do
        {{fk.pk_table.schema, fk.pk_table.name},
         {{name.schema, name.name}, Enum.zip(fk.pk_cols, fk.fk_cols)}}
      end
      |> Enum.group_by(&elem(&1, 0), &elem(&1, 1))
      |> Map.new(fn {dest, sources} -> {dest, Map.new(sources)} end)

    validate(
      %__MODULE__{
        paths: paths,
        fks: %{outbound: schema_version.fk_graph.fks, inbound: inbound_fks},
        pks: schema_version.primary_keys,
        fk_graph: graph,
        scopes: Map.keys(paths)
      },
      scoped_grants
    )
  end

  defp scoped_only(rules) do
    rules
    |> Enum.reject(&is_nil(&1.scope))
    |> Enum.map(fn %{scope: scope, table: table} -> {relation(scope), relation(table)} end)
    |> Enum.uniq()
  end

  defp relation(%SatPerms.Table{schema: schema, name: name}), do: {schema, name}

  @spec pk_val(t(), Changes.data_change()) :: Graph.id()
  def pk_val(structure, %Changes.NewRecord{} = change) do
    pk_val(structure, change.relation, change.record)
  end

  def pk_val(structure, %Changes.UpdatedRecord{} = change) do
    pk_val(structure, change.relation, change.old_record)
  end

  def pk_val(structure, %Changes.DeletedRecord{} = change) do
    pk_val(structure, change.relation, change.old_record)
  end

  @doc """
  Returns the primary key value for the given record.
  """
  @spec pk_val(t(), relation(), Graph.record()) :: Graph.id()
  def pk_val(%__MODULE__{pks: pks}, relation, record) do
    pks
    |> Map.fetch!(relation)
    |> Enum.map(&Map.fetch!(record, &1))
  end

  @doc """
  Returns the primary key column(s) for the given table.
  """
  @spec pk_col(t(), relation()) :: {:ok, col()} | :error
  def pk_col(%__MODULE__{pks: pks}, relation) do
    Map.fetch(pks, relation)
  end

  @spec foreign_keys(t(), relation(), relation()) :: [{relation(), [col()]}]
  # [VAX-1626] we don't support recursive relations
  def foreign_keys(%__MODULE__{}, root, root) do
    []
  end

  def foreign_keys(%__MODULE__{} = structure, root, relation) do
    case path(structure, root, relation) do
      [^relation, parent | _] ->
        [{parent, fk_cols(structure, parent, relation)}]

      _ ->
        []
    end
  end

  def foreign_keys(%__MODULE__{fks: %{outbound: fks}}, relation) do
    Map.get(fks, relation, %{})
  end

  def inbound_foreign_keys(%__MODULE__{fks: %{inbound: fks}}, relation) do
    Map.get(fks, relation, %{})
  end

  @doc """
  Returns a list of modified fks for the scope given by `root`.

  That is, does this update move this row, or any of the rows it points to, from one scope to
  another?

  The list is a list of `{relation(), old_id :: id(), new_id :: id()}` tuples, pointing to the row
  affected by the fk change (which in the case of many to one relations, would be the updated row
  itself).

  For many-to-one relations the `old_id` and `new_id` values will be identical. For one-to-{many,one}
  relations, the old- and new-ids will be different, reflecting the changed target of the foreign
  key.
  """
  @spec modified_fks(t(), relation(), Changes.UpdatedRecord.t()) :: [{relation(), Graph.id()}]
  def modified_fks(%__MODULE__{} = structure, {_, _} = root, %Changes.UpdatedRecord{} = update) do
    %Changes.UpdatedRecord{
      changed_columns: changed_columns,
      old_record: old,
      record: new,
      relation: relation
    } = update

    # so to determine if the change alters the row scope, we need some definitive view on the keys
    # that place the row in the scope with this idea of multiple paths to the scope root, this
    # isn't obvious
    path = MapSet.new(path(structure, root, relation) || [])

    structure
    |> foreign_keys(relation)
    |> Enum.filter(fn {fk_relation, _fk_cols} -> in_scope?(structure, root, fk_relation) end)
    |> Enum.filter(fn {_fk_relation, fk_cols} ->
      Enum.any?(fk_cols, &MapSet.member?(changed_columns, &1))
    end)
    |> Enum.map(fn {fk_relation, fk_cols} ->
      old_id = Enum.map(fk_cols, &Map.fetch!(old, &1))
      new_id = Enum.map(fk_cols, &Map.fetch!(new, &1))

      if fk_relation in path do
        # the change affects this row, that is fk changes pointing "up" the tree (towards
        # `root`)
        {relation, old_id, new_id}
      else
        # the change affects a table "down" the tree, away from the `root` we're not
        # checking that the relation is in the scope because it *has* to be if the
        # update relation is
        {fk_relation, old_id, new_id}
      end
    end)
  end

  def modified_fks?(%__MODULE__{} = structure, root, %Changes.UpdatedRecord{} = update) do
    %Changes.UpdatedRecord{
      changed_columns: changed_columns,
      relation: relation
    } = update

    structure
    |> foreign_keys(root, relation)
    |> Enum.filter(fn {_fk_relation, fk_cols} ->
      Enum.any?(fk_cols, &MapSet.member?(changed_columns, &1))
    end)
    |> then(&(!Enum.empty?(&1)))
  end

  @spec path(t(), relation(), relation()) :: [relation(), ...] | nil
  def path(%__MODULE__{paths: paths, fk_graph: fk_graph}, root, relation) do
    case Map.fetch(paths, root) do
      # if the root of the path matches one of our scopes, then we want the
      # pre-computed results we have to be authoritative
      {:ok, sub_paths} ->
        Map.get(sub_paths, relation, nil)

      # if the root isn't a perms scope, then fallback to a generic path traversal
      # the reason to not just do this as the default fallback is that the fkgraph
      # path traversal is too... creative, and will find a path through the foreign
      # keys that makes no sense for a permissions scope
      :error ->
        FkGraph.path(fk_graph, root, relation)
        # |> path_wrap()
    end
  end

  @spec in_scope?(t(), relation(), relation()) :: boolean()
  def in_scope?(%__MODULE__{} = structure, root, relation) do
    is_list(path(structure, root, relation))
  end

  @doc """
  Returns the parent references for a given record within the given scope. That is a list of
  `{relation(), id()}` tuples, based on the given relation and record.

  This does not lookup values in the tree, it merely uses the foreign key information and the
  values in the record.

  Returns `[]` if the given relation does not have a foreign key for the given scope (which may
  happen in the case of scopes built via join tables).
  """
  @spec parent(t(), relation(), relation(), Changes.record()) :: [{relation, Graph.id()}]
  def parent(%__MODULE__{} = structure, root, relation, record) do
    case path(structure, root, relation) do
      [^relation, parent_rel | _] ->
        fk_cols = fk_cols(structure, parent_rel, relation)
        [{parent_rel, Enum.map(fk_cols, &Map.get(record, &1, nil))}]

      _ ->
        []
    end
  end

  defp fk_cols(%__MODULE__{fks: %{outbound: fks}}, parent, relation) do
    # raise extemely unlikely
    cond do
      cols = get_in(fks, [relation, parent]) -> cols
      cols = get_in(fks, [parent, relation]) -> cols
      true -> raise "invalid schema: no fk relation between scope tables"
    end
  end

  defp validate(structure, grants) do
    Enum.reduce_while(grants, {:ok, structure}, fn {scope, table}, {:ok, structure} ->
      case path(structure, scope, table) do
        nil ->
          {:halt,
           {:error,
            "unable to traverse from #{Utils.inspect_relation(table)} to permissions scope #{Utils.inspect_relation(scope)}"}}

        [_ | _] ->
          {:cont, {:ok, structure}}
      end
    end)
  end
end
