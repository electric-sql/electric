defmodule Electric.Replication.Shapes.SentRowsGraph do
  require Logger
  @moduledoc """
  Module responsible for operations over the sent rows graph.

  We're keeping track of sent rows in a graph that has all references between rows, and
  why exactly they were sent.

  Graph nodes are row identifiers: pairs of a row relation (schema name and table name)
  and row primary key (a list in the order of the PK columns serialized as strings).

  Graph edges are more interesting: they are following the directions of shape requests
  over both one-to-many and many-to-one foreign keys on rows. When a row is added to the
  graph, it's linked to the "parent" that causes this row to be present in one of the shapes
  (or a special `:root` node for first-layer rows), and the edge between the "parent" and
  the new row is labeled with the unique key of the layer that allowed this to happen. A row
  can be linked to the same parent with multiple edges, each labeled with a different key
  if they are parts of multiple shapes.

  Graph edge key must be a 2-tuple where the first element is a "request id" - a unique ID
  of a requested shape within a connection and the second element is a deterministic value
  identifying the layer that caused this edge to exist.
  """
  alias Electric.Replication.Shapes.ShapeRequest

  @type row_id :: {ShapeRequest.relation(), [String.t(), ...]}

  @doc """
  Remove all edges from the sent rows graph that were added because of a given request id,
  returning deleted vertices that have no more incoming edges.

  ## Examples

      iex> {popped_vertices, new_graph} =
      ...>   Graph.new()
      ...>   |> Graph.add_edge(:root, :v1, label: {"r1", "l1"})
      ...>   |> Graph.add_edge(:root, :v1, label: {"r2", "l1"})
      ...>   |> Graph.add_edge(:v1, :v2, label: {"r1", "l2"})
      ...>   |> pop_by_request_ids("r1")
      iex> popped_vertices
      [:v2]
      iex> new_graph
      #Graph<type: directed, vertices: [:v1, :root], edges: [:root -[{"r2", "l1"}]-> :v1]>

      iex> {popped_vertices, new_graph} =
      ...>   Graph.new()
      ...>   |> Graph.add_edge(:root, :v1, label: {"r1", "l1"})
      ...>   |> Graph.add_edge(:root, :v1, label: {"r2", "l1"})
      ...>   |> Graph.add_edge(:v1, :v2, label: {"r1", "l2"})
      ...>   |> pop_by_request_ids(["r1", "r2"])
      iex> popped_vertices
      [:v2, :v1]
      iex> new_graph
      #Graph<type: directed, vertices: [:root], edges: []>

      iex> {popped_vertices, new_graph} =
      ...>   Graph.new()
      ...>   |> pop_by_request_ids(["r1", "r2"])
      iex> popped_vertices
      []
      iex> new_graph
      #Graph<type: directed, vertices: [], edges: []>
  """
  @spec pop_by_request_ids(Graph.t(), String.t() | [String.t()] | MapSet.t(String.t()), keyword()) ::
          {[row_id()], Graph.t()}
  def pop_by_request_ids(graph, request_id_or_ids, opts \\ [])

  def pop_by_request_ids(graph, [], _), do: {[], graph}

  def pop_by_request_ids(graph, id_or_ids, opts) when is_binary(id_or_ids) or is_list(id_or_ids),
    do: pop_by_request_ids(graph, MapSet.new(List.wrap(id_or_ids)), opts)

  def pop_by_request_ids(graph, %MapSet{} = request_ids, opts) do
    root_vertex = Keyword.get(opts, :root_vertex, :root)

    if Graph.has_vertex?(graph, root_vertex),
      do: do_pop_by_request_id(graph, request_ids, root_vertex),
      else: {[], graph}
  end

  defp do_pop_by_request_id(%Graph{} = graph, %MapSet{} = request_ids, root_vertex) do
    predicate = fn {id, _} -> MapSet.member?(request_ids, id) end

    {edges, vertices} =
      dfs_traverse(
        [Graph.Utils.vertex_id(root_vertex)],
        graph,
        {[], []},
        fn
          ^root_vertex, _, acc ->
            {:next, acc}

          v, incoming_edges, {edges, vertices} ->
            incoming_edges
            |> Enum.flat_map(fn {source_v, meta} ->
              Enum.map(Map.keys(meta), &{source_v, v, &1})
            end)
            |> Enum.split_with(&predicate.(elem(&1, 2)))
            |> case do
              {new_edges, []} ->
                # If all incoming edges match the request ID, we'll pop the vertex
                {:next, {new_edges ++ edges, [v | vertices]}}

              {new_edges, _rest} ->
                # If some incoming edges are unaffected, we'll pop the edges explicitly
                {:next, {new_edges ++ edges, vertices}}
            end
        end,
        fn meta -> any_key_matches_predicate?(meta, predicate) end
      )


    # Remove all edges relating to the request IDs from the graph
    graph =
      edges
      |> Enum.reduce(graph, fn {v1, v2, label}, acc -> Graph.delete_edge(acc, v1, v2, label) end)

    # Retain the maximally connected subgraph that does not contain the
    # vertices that have been popped
    vertices_to_keep = MapSet.difference(MapSet.new(Graph.vertices(graph)), MapSet.new(vertices)) |> MapSet.to_list
    graph = Graph.subgraph(graph, vertices_to_keep)

    {vertices, graph}
  end

  defp any_key_matches_predicate?(map, predicate) when is_map(map),
    do: any_key_matches_predicate?(:maps.iterator(map), predicate)

  defp any_key_matches_predicate?(iter, predicate) do
    case :maps.next(iter) do
      {k, _, iter} ->
        if predicate.(k), do: true, else: any_key_matches_predicate?(iter, predicate)

      :none ->
        false
    end
  end

  @doc false
  def dfs_traverse(
        vertices,
        graph,
        acc,
        fun,
        edge_predicate_fun,
        visited \\ MapSet.new()
      )

  def dfs_traverse(
        [v_id | rest],
        %Graph{out_edges: oe, in_edges: ie, vertices: vs, edges: e} = g,
        acc,
        fun,
        edge_predicate_fun,
        visited
      )
      when is_function(fun, 3) and is_function(edge_predicate_fun, 1) do
    if MapSet.member?(visited, v_id) do
      dfs_traverse(rest, g, acc, fun, edge_predicate_fun, visited)
    else
      v = Map.get(vs, v_id)
      in_edges = Enum.map(Map.get(ie, v_id, []), &{Map.fetch!(vs, &1), Map.fetch!(e, {&1, v_id})})

      case fun.(v, in_edges, acc) do
        {:next, acc2} ->
          visited = MapSet.put(visited, v_id)

          out =
            oe
            |> Map.get(v_id, MapSet.new())
            |> Enum.filter(&edge_predicate_fun.(Map.fetch!(e, {v_id, &1})))
            |> Enum.sort_by(fn id -> Graph.Utils.edge_weight(g, v_id, id) end)

          dfs_traverse(out ++ rest, g, acc2, fun, edge_predicate_fun, visited)

        {:skip, acc2} ->
          # Skip this vertex and it's out-neighbors
          visited = MapSet.put(visited, v_id)
          dfs_traverse(rest, g, acc2, fun, edge_predicate_fun, visited)

        {:halt, acc2} ->
          acc2
      end
    end
  end

  def dfs_traverse([], _g, acc, _, _, _) do
    acc
  end
end
