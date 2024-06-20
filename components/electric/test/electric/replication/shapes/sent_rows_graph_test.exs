defmodule Electric.Replication.Shapes.SentRowsGraphTest do
  use ExUnit.Case, async: true
  alias Electric.Replication.Shapes.SentRowsGraph

  doctest Electric.Replication.Shapes.SentRowsGraph, import: true

  describe "pop_by_request_ids/3" do
    test "should return the popped vertices and the new graph" do
      graph_init =
        Graph.new()
        |> Graph.add_edge(:root, :v1, label: {"r1", "l1"})
        |> Graph.add_edge(:root, :v1, label: {"r2", "l1"})
        |> Graph.add_edge(:v1, :v2, label: {"r1", "l2"})

      assert {[:v2], %Graph{} = graph_new} =
               SentRowsGraph.pop_by_request_ids(graph_init, "r1", root_vertex: :root)

      assert [:v1, :root] = Graph.vertices(graph_new)
      assert 1 = Graph.num_edges(graph_new)
      assert Graph.edge(graph_new, :root, :v1, {"r2", "l1"})
    end

    test "should be able to pop list of requests" do
      graph_init =
        Graph.new()
        |> Graph.add_edge(:root, :v1, label: {"r1", "l1"})
        |> Graph.add_edge(:root, :v1, label: {"r2", "l1"})
        |> Graph.add_edge(:v1, :v2, label: {"r1", "l2"})

      assert {[:v2, :v1], %Graph{} = graph_new} =
               SentRowsGraph.pop_by_request_ids(graph_init, ["r1", "r2"], root_vertex: :root)

      assert [:root] = Graph.vertices(graph_new)
      assert 0 = Graph.num_edges(graph_new)
    end

    test "should be able to pop empty graph" do
      graph_init = Graph.new()

      assert {[], %Graph{} = graph_new} =
               SentRowsGraph.pop_by_request_ids(graph_init, ["r1", "r2"])

      assert [] = Graph.vertices(graph_new)
      assert 0 = Graph.num_edges(graph_new)
    end
  end
end
