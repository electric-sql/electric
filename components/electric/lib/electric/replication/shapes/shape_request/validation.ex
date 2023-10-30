defmodule Electric.Replication.Shapes.ShapeRequest.Validation do
  alias Electric.Replication.Shapes.ShapeRequest.Layer
  alias Electric.Replication.Eval

  alias Electric.Postgres.Extension.SchemaLoader.Version, as: Schema

  alias Electric.Satellite.SatShapeDef.Relation
  alias Electric.Satellite.SatShapeDef.Select

  @type error :: {:error, {atom(), String.t()}}
  @type relation :: {String.t(), String.t()}
  @type layer_map :: Electric.Replication.Shapes.ShapeRequest.layer_map()

  @spec build_tree(%Select{}, Graph.t(), Schema.t(), term()) ::
          {:ok, Layer.t(), layer_map()} | error()
  def build_tree(%Select{} = select, fk_graph, schema, request_id) do
    with {:ok, base} <- prepare_layer_base(select, fk_graph, schema, request_id) do
      fill_layer_children(base, select.include, fk_graph, schema, request_id)
    end
  end

  @spec prepare_layer_base(%Select{}, Graph.t(), Schema.t(), term(), term()) ::
          {:ok, Layer.t()} | error()
  def prepare_layer_base(%Select{} = select, fk_graph, schema, request_id, parent_key \\ nil) do
    with {:ok, table} <- validate_table_exists(select.tablename, fk_graph),
         {:ok, where} <- validate_where(select.where, for: table, schema: schema) do
      select_hash =
        Base.encode64(
          :crypto.hash(:blake2b, :erlang.term_to_iovec({parent_key, select}, [:deterministic]))
        )

      {:ok,
       %Layer{
         request_id: request_id,
         target_table: table,
         target_pk: pks(schema, table),
         where_target: where,
         direction: :first_layer,
         key: {request_id, select_hash}
       }}
    end
  end

  defp pks(schema, table), do: Schema.primary_keys!(schema, table)

  @spec validate_table_exists(String.t(), Graph.t()) :: {:ok, relation()} | error()
  defp validate_table_exists(schema \\ "public", name, fk_graph) do
    cond do
      name == "" or String.length(name) not in 1..64 or not String.printable?(name) ->
        {:error, {:TABLE_NOT_FOUND, "Invalid table name"}}

      not Graph.has_vertex?(fk_graph, {schema, name}) ->
        {:error, {:TABLE_NOT_FOUND, "Unknown table #{name}"}}

      true ->
        {:ok, {schema, name}}
    end
  end

  @doc """
  Validate a given where clause using information about the table columns from the schema.
  """
  @spec validate_where(String.t(), for: relation(), schema: Schema.t()) ::
          {:ok, nil | Eval.Expr.t()} | error()
  def validate_where("", _), do: {:ok, nil}

  def validate_where(clause, for: table, schema: schema) do
    refs =
      Schema.table!(schema, table)
      |> Map.fetch!(:columns)
      |> Map.new(fn %{name: name, type: %{name: type}} ->
        {["this", name], String.to_atom(type)}
      end)

    case Eval.Parser.parse_and_validate_expression(clause, refs) do
      {:ok, %{returns: :bool} = parsed} ->
        {:ok, parsed}

      {:ok, %{returns: type}} ->
        {:error,
         {:INVALID_WHERE_CLAUSE,
          "Where expression should evaluate to a boolean, but it's #{inspect(type)}"}}

      {:error, reason} ->
        {:error, {:INVALID_WHERE_CLAUSE, reason}}
    end
  end

  @spec fill_layer_children(Layer.t(), [%Relation{}], Graph.t(), Schema.t(), term()) ::
          {:ok, Layer.t(), layer_map()} | error()
  defp fill_layer_children(%Layer{} = layer, relations, fk_graph, schema, request_id) do
    with {:ok, children, table_map} <-
           map_relations(relations, layer, fk_graph, schema, request_id),
         layer = %Layer{layer | next_layers: children},
         :ok <- check_no_duplicates(layer),
         {:ok, layer, more_table_map} <- fill_fk_references(layer, fk_graph, schema, request_id) do
      total_map =
        table_map
        |> Map.merge(more_table_map, fn _, v1, v2 -> v1 ++ v2 end)
        |> Map.update(layer.target_table, [layer], &[layer | &1])

      {:ok, layer, total_map}
    end
  end

  @spec map_relations(
          [%Relation{}],
          Layer.t(),
          Graph.t(),
          Schema.t(),
          term(),
          {[Layer.t()], layer_map()}
        ) ::
          {:ok, [Layer.t()], layer_map()} | error()
  defp map_relations(relations, parent, fk_graph, schema, request_id, acc \\ {[], %{}})

  defp map_relations([], _, _, _, _, {acc, layer_map}), do: {:ok, acc, layer_map}

  defp map_relations([relation | tail], parent, fk_graph, schema, request_id, {acc, total_map})
       when is_struct(parent, Layer) and is_struct(fk_graph, Graph) and
              is_struct(relation, Relation) do
    with {:ok, %{select: select, foreign_key: fk}} <- validate_relation(relation),
         {:ok, layer} <- prepare_layer_base(select, fk_graph, schema, request_id, parent.key),
         {:ok, layer} <- fill_parent(layer, parent, fk_graph, fk),
         {:ok, layer, layer_map} <-
           fill_layer_children(layer, select.include, fk_graph, schema, request_id) do
      acc = [layer | acc]
      total_map = Map.merge(total_map, layer_map, fn _, v1, v2 -> v1 ++ v2 end)

      map_relations(tail, parent, fk_graph, schema, request_id, {acc, total_map})
    end
  end

  @spec validate_relation(%Relation{}) :: {:ok, %Relation{}} | error()
  defp validate_relation(%Relation{select: select} = rel) when not is_nil(select), do: {:ok, rel}

  defp validate_relation(_),
    do: {:error, {:INVALID_INCLUDE_TREE, "Relation has to have a FK and a select"}}

  @spec fill_parent(Layer.t(), Layer.t(), Graph.t(), [String.t(), ...]) ::
          {:ok, Layer.t()} | error()
  defp fill_parent(%Layer{} = base, %Layer{} = parent, fk_graph, fk) when is_list(fk) do
    layer = %Layer{
      base
      | fk: fk,
        parent_key: parent.key,
        source_pk: parent.target_pk,
        source_table: parent.target_table
    }

    cond do
      Graph.edge(fk_graph, layer.target_table, layer.source_table, fk) ->
        {:ok, %Layer{layer | direction: :one_to_many}}

      Graph.edge(fk_graph, layer.source_table, layer.target_table, fk) ->
        {:ok, %Layer{layer | direction: :many_to_one}}

      true ->
        {:error,
         {:INVALID_INCLUDE_TREE,
          "Relation between #{inspect(layer.source_table)} and #{inspect(layer.target_table)} over FK #{inspect(fk)} does not exist"}}
    end
  end

  @spec check_no_duplicates(Layer.t()) :: :ok | error()
  defp check_no_duplicates(%Layer{next_layers: children_layers}) do
    children_layers
    |> Enum.frequencies_by(&{&1.target_table, &1.fk, &1.direction})
    |> Enum.find(fn {_, k} -> k > 1 end)
    |> case do
      nil -> :ok
      _ -> {:error, {:INVALID_INCLUDE_TREE, "Cannot traverse same relationship twice"}}
    end
  end

  defp fill_fk_references(%Layer{next_layers: children} = layer, fk_graph, schema, request_id) do
    # TODO: This does _not_ work with any self-referential and multi-table recursive relations

    fk_graph
    |> Graph.out_edges(layer.target_table)
    |> Enum.reject(fn %Graph.Edge{v2: relation, label: fk} ->
      # We're filtering out the "incoming" edge on the shape request, and all outgoing edges
      (layer.direction == :one_to_many and layer.source_table == relation and layer.fk == fk) or
        Enum.any?(children, &layer_matches_outgoing?(&1, relation, fk))
    end)
    |> case do
      [] ->
        {:ok, layer, %{}}

      edges ->
        relations =
          Enum.map(edges, fn %Graph.Edge{v2: {"public", table}, label: fk} ->
            %Relation{foreign_key: fk, select: %Select{tablename: table}}
          end)

        with {:ok, more_children, table_map} <-
               map_relations(relations, layer, fk_graph, schema, request_id) do
          {:ok, %Layer{layer | next_layers: children ++ more_children}, table_map}
        end
    end
  end

  defp layer_matches_outgoing?(
         %Layer{direction: :many_to_one, fk: fk, target_table: relation},
         relation,
         fk
       ),
       do: true

  defp layer_matches_outgoing?(%Layer{}, _, _), do: false
end
