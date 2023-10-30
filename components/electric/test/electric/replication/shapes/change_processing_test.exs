defmodule Electric.Replication.Shapes.ChangeProcessingTest do
  use ExUnit.Case, async: true

  alias Electric.Replication.Changes.NewRecord
  alias Electric.Replication.Changes.DeletedRecord
  alias Electric.Replication.Changes.UpdatedRecord
  alias Electric.Replication.Eval
  alias Electric.Replication.Shapes.ShapeRequest.Layer
  alias Electric.Replication.Shapes.ChangeProcessing
  import Electric.Replication.Shapes.ChangeProcessing.Reduction

  @rel_proj {"public", "projects"}
  @rel_iss {"public", "issues"}
  @base_cols %{
    ["this", "id"] => :uuid,
    ["this", "in_shape"] => :bool,
    ["this", "unrelated"] => :int4
  }
  @base_where Eval.Parser.parse_and_validate_expression!("this.in_shape = true", @base_cols)
  @base_uuid_1 "00000000-0000-0000-0000-000000000000"
  @base_uuid_2 "00000000-0000-0000-0000-000000000001"
  @base_uuid_3 "00000000-0000-0000-0000-000000000002"
  @first_layer_project %Layer{
    direction: :first_layer,
    target_table: @rel_proj,
    target_pk: ["id"],
    key: "l1",
    where_target: @base_where
  }

  @first_layer_issue %Layer{
    direction: :first_layer,
    target_table: @rel_iss,
    target_pk: ["id"],
    key: "l1",
    where_target: @base_where
  }

  describe "NewRecord" do
    test "single layer, top" do
      # Setup: layer, current graph, and actual event
      layer = @first_layer_project

      graph = Graph.new()

      event = %NewRecord{
        relation: @rel_proj,
        record: %{"id" => @base_uuid_1, "in_shape" => "t"}
      }

      base = reduction(graph: graph)

      # Processing
      assert reduction(graph: new_graph, operations: operations) =
               ChangeProcessing.process(event, layer, base)

      # Assertions
      id = ChangeProcessing.id(event.record, layer.target_table, layer.target_pk)

      assert ChangeProcessing.row_in_graph?(new_graph, id, layer.key)
      assert %{event => nil} == operations
    end

    test "single layer, one-to-many when parent is in graph" do
      # Setup: layer, current graph, and actual event
      layer = %Layer{
        direction: :one_to_many,
        source_table: @rel_proj,
        source_pk: ["id"],
        target_table: @rel_iss,
        target_pk: ["id"],
        key: "l2",
        fk: ["project_id"],
        parent_key: "l1",
        where_target: @base_where
      }

      graph =
        ChangeProcessing.add_to_graph(Graph.new(), @first_layer_project, %{"id" => @base_uuid_1})

      event = %NewRecord{
        relation: @rel_iss,
        record: %{"id" => @base_uuid_2, "in_shape" => "t", "project_id" => @base_uuid_1}
      }

      base = reduction(graph: graph)

      # Processing
      assert reduction(graph: new_graph, operations: operations) =
               ChangeProcessing.process(event, layer, base)

      # Assertions
      id = ChangeProcessing.id(event.record, layer.target_table, layer.target_pk)

      assert ChangeProcessing.row_in_graph?(new_graph, id, layer.key)
      assert %{event => nil} == operations
    end

    test "single layer, one-to-many when parent is NOT in graph" do
      # Setup: layer, current graph, and actual event
      layer = %Layer{
        direction: :one_to_many,
        source_table: @rel_proj,
        source_pk: ["id"],
        target_table: @rel_iss,
        target_pk: ["id"],
        key: "l2",
        fk: ["project_id"],
        parent_key: "l1",
        where_target: @base_where
      }

      graph = Graph.new()

      event = %NewRecord{
        relation: @rel_iss,
        record: %{"id" => @base_uuid_2, "in_shape" => "t", "project_id" => @base_uuid_1}
      }

      base = reduction(graph: graph)

      # Processing
      assert reduction(graph: new_graph, operations: operations, buffer: buffer) =
               ChangeProcessing.process(event, layer, base)

      # Assertions
      id = ChangeProcessing.id(event.record, layer.target_table, layer.target_pk)

      refute ChangeProcessing.row_in_graph?(new_graph, id, layer.key)
      assert operations == %{}

      assert ChangeProcessing.waiting_for?(
               buffer,
               layer,
               ChangeProcessing.id(%{"id" => @base_uuid_1}, @rel_proj, ["id"])
             )
    end

    test "single layer, many-to-one when parent insert/update has not been seen yet" do
      # Setup: layer, current graph, and actual event
      layer = %Layer{
        direction: :many_to_one,
        source_table: @rel_iss,
        source_pk: ["id"],
        target_table: @rel_proj,
        target_pk: ["id"],
        key: "l2",
        fk: ["project_id"],
        parent_key: "l1"
      }

      graph = Graph.new()

      event = %NewRecord{
        relation: @rel_proj,
        record: %{"id" => @base_uuid_1, "in_shape" => "t"}
      }

      base = reduction(graph: graph)

      # Processing
      assert reduction(graph: new_graph, operations: operations, buffer: buffer) =
               ChangeProcessing.process(event, layer, base)

      # Assertions
      id = ChangeProcessing.id(event.record, layer.target_table, layer.target_pk)

      refute ChangeProcessing.row_in_graph?(new_graph, id, layer.key)
      assert operations == %{}

      assert ChangeProcessing.waiting_for?(
               buffer,
               layer,
               ChangeProcessing.id(%{"id" => @base_uuid_1}, @rel_proj, ["id"])
             )
    end

    test "single layer, many-to-one when parent insert/update already seen" do
      # Setup: layer, current graph, and actual event
      layer = %Layer{
        direction: :many_to_one,
        source_table: @rel_iss,
        source_pk: ["id"],
        target_table: @rel_proj,
        target_pk: ["id"],
        key: "l2",
        fk: ["project_id"],
        parent_key: "l1"
      }

      graph =
        ChangeProcessing.add_to_graph(Graph.new(), @first_layer_issue, %{"id" => @base_uuid_2})

      event = %NewRecord{
        relation: @rel_proj,
        record: %{"id" => @base_uuid_1, "in_shape" => "t"}
      }

      # Processing
      base =
        reduction(graph: graph)
        |> ChangeProcessing.trigger_buffer_fk_event(layer, %{
          "id" => @base_uuid_2,
          "project_id" => @base_uuid_1
        })

      # Processing
      assert reduction(graph: new_graph, operations: operations, buffer: buffer) =
               ChangeProcessing.process(event, layer, base)

      # Assertions
      id = ChangeProcessing.id(event.record, layer.target_table, layer.target_pk)

      assert ChangeProcessing.row_in_graph?(new_graph, id, layer.key)
      assert operations == %{event => nil}

      refute ChangeProcessing.waiting_for?(
               buffer,
               layer,
               ChangeProcessing.id(%{"id" => @base_uuid_1}, @rel_proj, ["id"])
             )
    end

    test "multiple layers, many-to-one, result is the same regardless of txn order" do
      # Setup: layer, current graph, and actual event

      l2 = %Layer{
        direction: :many_to_one,
        source_table: @rel_iss,
        source_pk: ["id"],
        target_table: @rel_proj,
        target_pk: ["id"],
        key: "l2",
        fk: ["project_id"],
        parent_key: "l1"
      }

      l1 = %{@first_layer_issue | next_layers: [l2]}

      graph = Graph.new()

      e1 = %NewRecord{
        relation: @rel_iss,
        record: %{"id" => @base_uuid_2, "in_shape" => "t", "project_id" => @base_uuid_1}
      }

      e2 = %NewRecord{
        relation: @rel_proj,
        record: %{"id" => @base_uuid_1, "in_shape" => "t"}
      }

      base = reduction(graph: graph)

      id1 = ChangeProcessing.id(e1.record, l1.target_table, l1.target_pk)
      id2 = ChangeProcessing.id(e2.record, l2.target_table, l2.target_pk)

      # Processing

      state = ChangeProcessing.process(e1, l1, base)

      assert reduction(graph: new_graph, operations: ops) =
               ChangeProcessing.process(e2, l2, state)

      # Assertions

      assert ChangeProcessing.row_in_graph?(new_graph, id1, l1.key)
      assert ChangeProcessing.row_in_graph?(new_graph, id2, l2.key)
      assert %{e1 => nil, e2 => nil} == ops

      # Processing, again, events in reverse order
      state = ChangeProcessing.process(e2, l2, base)

      assert reduction(graph: new_graph, operations: ops) =
               ChangeProcessing.process(e1, l1, state)

      # Assertions

      assert ChangeProcessing.row_in_graph?(new_graph, id1, l1.key)
      assert ChangeProcessing.row_in_graph?(new_graph, id2, l2.key)
      assert %{e1 => nil, e2 => nil} == ops
    end

    test "multiple layers, one-to-many, result is the same regardless of txn order" do
      # Setup: layer, current graph, and actual event

      l2 = %Layer{
        direction: :one_to_many,
        source_table: @rel_proj,
        source_pk: ["id"],
        target_table: @rel_iss,
        target_pk: ["id"],
        key: "l2",
        fk: ["project_id"],
        parent_key: "l1"
      }

      l1 = %{@first_layer_project | next_layers: [l2]}

      graph = Graph.new()

      e1 = %NewRecord{
        relation: @rel_proj,
        record: %{"id" => @base_uuid_1, "in_shape" => "t"}
      }

      e2 = %NewRecord{
        relation: @rel_iss,
        record: %{"id" => @base_uuid_2, "in_shape" => "t", "project_id" => @base_uuid_1}
      }

      base = reduction(graph: graph)

      id1 = ChangeProcessing.id(e1.record, l1.target_table, l1.target_pk)
      id2 = ChangeProcessing.id(e2.record, l2.target_table, l2.target_pk)

      # Processing
      state = ChangeProcessing.process(e1, l1, base)

      assert reduction(graph: new_graph, operations: ops) =
               ChangeProcessing.process(e2, l2, state)

      # Assertions

      assert ChangeProcessing.row_in_graph?(new_graph, id1, l1.key)
      assert ChangeProcessing.row_in_graph?(new_graph, id2, l2.key)
      assert %{e1 => nil, e2 => nil} == ops

      # Processing, again, events in reverse order
      state = ChangeProcessing.process(e2, l2, base)

      assert reduction(graph: new_graph, operations: ops) =
               ChangeProcessing.process(e1, l1, state)

      # Assertions

      assert ChangeProcessing.row_in_graph?(new_graph, id1, l1.key)
      assert ChangeProcessing.row_in_graph?(new_graph, id2, l2.key)
      assert %{e1 => nil, e2 => nil} == ops
    end

    test "multiple layers, many-to-one, correctly links the graph up for multiple 'many' records" do
      # Setup: layer, current graph, and actual event

      l2 = %Layer{
        direction: :many_to_one,
        source_table: @rel_iss,
        source_pk: ["id"],
        target_table: @rel_proj,
        target_pk: ["id"],
        key: "l2",
        fk: ["project_id"],
        parent_key: "l1"
      }

      l1 = %{@first_layer_issue | next_layers: [l2]}

      graph = Graph.new()

      e1 = %NewRecord{
        relation: @rel_proj,
        record: %{"id" => @base_uuid_1, "in_shape" => "t"}
      }

      e2 = %NewRecord{
        relation: @rel_iss,
        record: %{"id" => @base_uuid_2, "in_shape" => "t", "project_id" => @base_uuid_1}
      }

      e3 = %NewRecord{
        relation: @rel_iss,
        record: %{"id" => @base_uuid_3, "in_shape" => "t", "project_id" => @base_uuid_1}
      }

      base = reduction(graph: graph)

      id1 = ChangeProcessing.id(e1.record, l2.target_table, l2.target_pk)
      id2 = ChangeProcessing.id(e2.record, l1.target_table, l1.target_pk)
      id3 = ChangeProcessing.id(e3.record, l1.target_table, l1.target_pk)

      # Processing
      state = ChangeProcessing.process(e1, l2, base)
      state = ChangeProcessing.process(e2, l1, state)

      assert reduction(graph: new_graph, operations: ops) =
               ChangeProcessing.process(e3, l1, state)

      # Assertions

      assert ChangeProcessing.row_in_graph?(new_graph, id3, l1.key)
      assert ChangeProcessing.row_in_graph?(new_graph, id2, l1.key)
      assert ChangeProcessing.row_in_graph?(new_graph, id1, l2.key)
      assert %{e1 => nil, e2 => nil, e3 => nil} == ops
    end
  end

  describe "DeletedRecord" do
    test "single layer, top" do
      # Setup: layer, current graph, and actual event
      layer = @first_layer_project

      record = %{"id" => @base_uuid_1, "in_shape" => "t"}

      graph = ChangeProcessing.add_to_graph(Graph.new(), layer, record)

      event = %DeletedRecord{
        relation: @rel_proj,
        old_record: record
      }

      base = reduction(graph: graph)

      id = ChangeProcessing.id(event.old_record, layer.target_table, layer.target_pk)
      assert ChangeProcessing.row_in_graph?(graph, id, layer.key)

      # Processing
      assert reduction(graph: new_graph, operations: operations) =
               ChangeProcessing.process(event, layer, base)

      # Assertions

      refute ChangeProcessing.row_in_graph?(new_graph, id, layer.key)
      refute Graph.has_vertex?(new_graph, id)
      assert %{event => nil} == operations
    end

    test "two layers, many-to-one cascade" do
      # Setup: layer, current graph, and actual event
      l2 = %Layer{
        direction: :many_to_one,
        source_table: @rel_iss,
        source_pk: ["id"],
        target_table: @rel_proj,
        target_pk: ["id"],
        key: "l2",
        fk: ["project_id"],
        parent_key: "l1"
      }

      l1 = %{@first_layer_issue | next_layers: [l2]}

      iss_record = %{"id" => @base_uuid_2, "in_shape" => "t", "project_id" => @base_uuid_1}
      proj_record = %{"id" => @base_uuid_1, "in_shape" => "t"}

      id = ChangeProcessing.id(iss_record, l1.target_table, l1.target_pk)
      proj_id = ChangeProcessing.id(proj_record, l2.target_table, l2.target_pk)

      graph =
        Graph.new()
        |> ChangeProcessing.add_to_graph(l1, iss_record)
        |> ChangeProcessing.add_to_graph(l2, proj_record, id)

      event = %DeletedRecord{
        relation: @rel_iss,
        old_record: iss_record
      }

      base = reduction(graph: graph)

      assert ChangeProcessing.row_in_graph?(graph, id, l1.key)
      assert ChangeProcessing.row_in_graph?(graph, proj_id, l2.key)

      # Processing
      reduction(graph: new_graph, operations: operations, gone_nodes: gone) =
        ChangeProcessing.process(event, l1, base)

      # Assertions

      refute ChangeProcessing.row_in_graph?(new_graph, id, l1.key)
      refute Graph.has_vertex?(new_graph, id)
      refute ChangeProcessing.row_in_graph?(new_graph, proj_id, l2.key)
      refute Graph.has_vertex?(new_graph, proj_id)
      assert %{event => nil} == operations
      refute MapSet.member?(gone, id)
      assert MapSet.member?(gone, proj_id)
    end

    test "two layers, one-to-many cascade" do
      # Setup: layer, current graph, and actual event

      l2 = %Layer{
        direction: :one_to_many,
        source_table: @rel_proj,
        source_pk: ["id"],
        target_table: @rel_iss,
        target_pk: ["id"],
        key: "l2",
        fk: ["project_id"],
        parent_key: "l1"
      }

      l1 = %{@first_layer_project | next_layers: [l2]}

      proj_record = %{"id" => @base_uuid_1, "in_shape" => "t"}
      iss_record = %{"id" => @base_uuid_2, "in_shape" => "t", "project_id" => @base_uuid_1}

      proj_id = ChangeProcessing.id(proj_record, l1.target_table, l1.target_pk)
      iss_id = ChangeProcessing.id(iss_record, l2.target_table, l2.target_pk)

      graph =
        Graph.new()
        |> ChangeProcessing.add_to_graph(l1, proj_record)
        |> ChangeProcessing.add_to_graph(l2, iss_record, proj_id)

      event = %DeletedRecord{
        relation: @rel_proj,
        old_record: proj_record
      }

      base = reduction(graph: graph)

      assert ChangeProcessing.row_in_graph?(graph, proj_id, l1.key)
      assert ChangeProcessing.row_in_graph?(graph, iss_id, l2.key)

      # Processing
      reduction(graph: new_graph, operations: operations, gone_nodes: gone) =
        ChangeProcessing.process(event, l1, base)

      # Assertions

      refute ChangeProcessing.row_in_graph?(new_graph, proj_id, l1.key)
      refute Graph.has_vertex?(new_graph, proj_id)
      refute ChangeProcessing.row_in_graph?(new_graph, iss_id, l2.key)
      refute Graph.has_vertex?(new_graph, iss_id)
      assert %{event => nil} == operations
      refute MapSet.member?(gone, proj_id)
      assert MapSet.member?(gone, iss_id)
    end

    test "two layers, many-to-one cascade only if there are no more links left in the graph" do
      # Setup: layer, current graph, and actual event
      l2 = %Layer{
        direction: :many_to_one,
        source_table: @rel_iss,
        source_pk: ["id"],
        target_table: @rel_proj,
        target_pk: ["id"],
        key: "l2",
        fk: ["project_id"],
        parent_key: "l1"
      }

      l1 = %{@first_layer_issue | next_layers: [l2]}

      iss1_record = %{"id" => @base_uuid_2, "in_shape" => "t", "project_id" => @base_uuid_1}
      iss2_record = %{"id" => @base_uuid_3, "in_shape" => "t", "project_id" => @base_uuid_1}
      proj_record = %{"id" => @base_uuid_1, "in_shape" => "t"}

      iss_id1 = ChangeProcessing.id(iss1_record, l1.target_table, l1.target_pk)
      iss_id2 = ChangeProcessing.id(iss2_record, l1.target_table, l1.target_pk)
      proj_id = ChangeProcessing.id(proj_record, l2.target_table, l2.target_pk)

      graph =
        Graph.new()
        |> ChangeProcessing.add_to_graph(l1, iss1_record)
        |> ChangeProcessing.add_to_graph(l1, iss2_record)
        |> ChangeProcessing.add_to_graph(l2, proj_record, iss_id1)
        |> ChangeProcessing.add_to_graph(l2, proj_record, iss_id2)

      event = %DeletedRecord{
        relation: @rel_iss,
        old_record: iss1_record
      }

      base = reduction(graph: graph)

      assert ChangeProcessing.row_in_graph?(graph, iss_id1, l1.key)
      assert ChangeProcessing.row_in_graph?(graph, proj_id, l2.key)

      # Processing
      reduction(graph: new_graph, operations: operations, gone_nodes: gone) =
        ChangeProcessing.process(event, l1, base)

      # Assertions

      refute ChangeProcessing.row_in_graph?(new_graph, iss_id1, l1.key)
      refute Graph.has_vertex?(new_graph, iss_id1)
      assert ChangeProcessing.row_in_graph?(new_graph, proj_id, l2.key)
      assert Graph.has_vertex?(new_graph, proj_id)
      assert %{event => nil} == operations
      refute MapSet.member?(gone, iss_id1)
      refute MapSet.member?(gone, proj_id)
    end

    test "GONE upgrades to DELETED" do
      # Setup: layer, current graph, and actual event
      l2 = %Layer{
        direction: :many_to_one,
        source_table: @rel_iss,
        source_pk: ["id"],
        target_table: @rel_proj,
        target_pk: ["id"],
        key: "l2",
        fk: ["project_id"],
        parent_key: "l1"
      }

      l1 = %{@first_layer_issue | next_layers: [l2]}

      iss_record = %{"id" => @base_uuid_2, "in_shape" => "t", "project_id" => @base_uuid_1}
      proj_record = %{"id" => @base_uuid_1, "in_shape" => "t"}

      id = ChangeProcessing.id(iss_record, l1.target_table, l1.target_pk)
      proj_id = ChangeProcessing.id(proj_record, l2.target_table, l2.target_pk)

      graph =
        Graph.new()
        |> ChangeProcessing.add_to_graph(l1, iss_record)
        |> ChangeProcessing.add_to_graph(l2, proj_record, id)

      e1 = %DeletedRecord{
        relation: @rel_iss,
        old_record: iss_record
      }

      e2 = %DeletedRecord{
        relation: @rel_proj,
        old_record: proj_record
      }

      base = reduction(graph: graph)

      assert ChangeProcessing.row_in_graph?(graph, id, l1.key)
      assert ChangeProcessing.row_in_graph?(graph, proj_id, l2.key)

      # Processing
      state = ChangeProcessing.process(e1, l1, base)

      reduction(graph: new_graph, operations: operations, gone_nodes: gone) =
        ChangeProcessing.process(e2, l2, state)

      # Assertions
      refute ChangeProcessing.row_in_graph?(new_graph, id, l1.key)
      refute Graph.has_vertex?(new_graph, id)
      refute ChangeProcessing.row_in_graph?(new_graph, id, l1.key)
      refute Graph.has_vertex?(new_graph, id)
      assert %{e1 => nil, e2 => nil} == operations
      refute MapSet.member?(gone, id)
      refute MapSet.member?(gone, proj_id)
    end
  end

  describe "UpdatedRecord" do
    test "single layer, first layer, stay-in" do
      # Setup: layer, current graph, and actual event
      layer = @first_layer_project

      record = %{"id" => @base_uuid_1, "in_shape" => "t", "unrelated" => "1"}

      graph = ChangeProcessing.add_to_graph(Graph.new(), layer, record)

      event = %UpdatedRecord{
        relation: @rel_proj,
        old_record: record,
        record: %{"id" => @base_uuid_1, "in_shape" => "t", "unrelated" => "2"}
      }

      base = reduction(graph: graph)

      # Processing
      assert reduction(graph: new_graph, operations: operations) =
               ChangeProcessing.process(event, layer, base)

      # Assertions
      id = ChangeProcessing.id(event.record, layer.target_table, layer.target_pk)

      assert graph == new_graph
      assert ChangeProcessing.row_in_graph?(new_graph, id, layer.key)
      assert %{event => :updated_record} == operations
    end

    test "single layer, first layer, stay-out" do
      # Setup: layer, current graph, and actual event
      layer = @first_layer_project

      record = %{"id" => @base_uuid_1, "in_shape" => "f", "unrelated" => "1"}

      graph = Graph.new()

      event = %UpdatedRecord{
        relation: @rel_proj,
        old_record: record,
        record: %{"id" => @base_uuid_1, "in_shape" => "f", "unrelated" => "2"}
      }

      base = reduction(graph: graph)

      # Processing
      assert reduction(graph: new_graph, operations: operations) =
               ChangeProcessing.process(event, layer, base)

      # Assertions
      id = ChangeProcessing.id(event.record, layer.target_table, layer.target_pk)

      assert graph == new_graph
      refute ChangeProcessing.row_in_graph?(new_graph, id, layer.key)
      assert %{} == operations
    end

    test "single layer, first layer, move-in" do
      # Setup: layer, current graph, and actual event
      layer = @first_layer_project

      record = %{"id" => @base_uuid_1, "in_shape" => "f"}
      new_record = %{"id" => @base_uuid_1, "in_shape" => "t"}

      graph = Graph.new()

      event = %UpdatedRecord{
        relation: @rel_proj,
        old_record: record,
        record: new_record
      }

      base = reduction(graph: graph)

      # Processing
      assert reduction(graph: new_graph, operations: operations, actions: actions) =
               ChangeProcessing.process(event, layer, base)

      # Assertions
      id = ChangeProcessing.id(event.record, layer.target_table, layer.target_pk)

      assert ChangeProcessing.row_in_graph?(new_graph, id, layer.key)
      assert %{event => :new_record} == operations
      assert %{} == actions
    end

    test "single layer, first layer, move-out" do
      # Setup: layer, current graph, and actual event
      layer = @first_layer_project

      record = %{"id" => @base_uuid_1, "in_shape" => "t"}
      new_record = %{"id" => @base_uuid_1, "in_shape" => "f"}

      graph = Graph.new() |> ChangeProcessing.add_to_graph(layer, record)

      event = %UpdatedRecord{
        relation: @rel_proj,
        old_record: record,
        record: new_record
      }

      base = reduction(graph: graph)

      # Processing
      assert reduction(graph: new_graph, operations: operations, actions: actions) =
               ChangeProcessing.process(event, layer, base)

      # Assertions
      id = ChangeProcessing.id(event.record, layer.target_table, layer.target_pk)

      refute ChangeProcessing.row_in_graph?(new_graph, id, layer.key)
      assert %{event => :deleted_record} == operations
      assert %{} == actions
    end

    test "two layers, many-to-one, child update with parent in graph is sent" do
      # Setup: layer, current graph, and actual event
      l2 = %Layer{
        direction: :many_to_one,
        source_table: @rel_iss,
        source_pk: ["id"],
        target_table: @rel_proj,
        target_pk: ["id"],
        key: "l2",
        fk: ["project_id"],
        parent_key: "l1"
      }

      l1 = %{@first_layer_issue | next_layers: [l2]}

      iss_record = %{"id" => @base_uuid_2, "in_shape" => "t", "project_id" => @base_uuid_1}
      proj_record = %{"id" => @base_uuid_1, "in_shape" => "t", "unrelated" => "1"}

      iss_id = ChangeProcessing.id(iss_record, l1.target_table, l1.target_pk)
      proj_id = ChangeProcessing.id(proj_record, l2.target_table, l2.target_pk)

      graph =
        Graph.new()
        |> ChangeProcessing.add_to_graph(l1, iss_record)
        |> ChangeProcessing.add_to_graph(l2, proj_record, iss_id)

      new_record = %{"id" => @base_uuid_1, "in_shape" => "t", "unrelated" => "2"}

      event = %UpdatedRecord{
        relation: @rel_proj,
        old_record: proj_record,
        record: new_record
      }

      base = reduction(graph: graph)

      # Processing
      assert reduction(graph: new_graph, operations: operations, actions: actions) =
               ChangeProcessing.process(event, l2, base)

      # Assertions
      assert graph == new_graph
      assert ChangeProcessing.row_in_graph?(new_graph, proj_id, l2.key)
      assert %{event => :updated_record} == operations
      assert %{} == actions
    end

    test "two layers, many-to-one, child update with parent not in graph is buffered and then processed" do
      # Setup: layer, current graph, and actual event
      l2 = %Layer{
        direction: :many_to_one,
        source_table: @rel_iss,
        source_pk: ["id"],
        target_table: @rel_proj,
        target_pk: ["id"],
        key: "l2",
        fk: ["project_id"],
        parent_key: "l1"
      }

      l1 = %{@first_layer_issue | next_layers: [l2]}

      iss_record = %{"id" => @base_uuid_2, "in_shape" => "t", "project_id" => @base_uuid_1}
      proj_record = %{"id" => @base_uuid_1, "in_shape" => "t", "unrelated" => "1"}

      iss_id = ChangeProcessing.id(iss_record, l1.target_table, l1.target_pk)
      proj_id = ChangeProcessing.id(proj_record, l2.target_table, l2.target_pk)

      graph = Graph.new()

      new_record = %{"id" => @base_uuid_1, "in_shape" => "t", "unrelated" => "2"}

      e1 = %UpdatedRecord{
        relation: @rel_proj,
        old_record: proj_record,
        record: new_record
      }

      e2 = %NewRecord{relation: @rel_iss, record: iss_record}

      base = reduction(graph: graph)

      # Processing
      assert reduction(graph: new_graph, operations: operations, buffer: buffer, actions: actions) =
               state =
               ChangeProcessing.process(e1, l2, base)

      # Assertions
      assert graph == new_graph
      refute ChangeProcessing.row_in_graph?(new_graph, proj_id, l2.key)
      assert %{} == operations
      assert %{} == actions

      assert ChangeProcessing.waiting_for?(
               buffer,
               l2,
               ChangeProcessing.id(%{"id" => @base_uuid_1}, @rel_proj, ["id"])
             )

      # Issue referencing this project is in the same txn
      assert reduction(graph: new_graph, operations: operations) =
               ChangeProcessing.process(e2, l1, state)

      # Assertions
      assert ChangeProcessing.row_in_graph?(new_graph, iss_id, l1.key)
      assert ChangeProcessing.row_in_graph?(new_graph, proj_id, l2.key)
      assert %{e1 => :new_record, e2 => nil} == operations
    end

    test "two layers, many-to-one, parent move-out cascades" do
      # Setup: layer, current graph, and actual event
      l2 = %Layer{
        direction: :many_to_one,
        source_table: @rel_iss,
        source_pk: ["id"],
        target_table: @rel_proj,
        target_pk: ["id"],
        key: "l2",
        fk: ["project_id"],
        parent_key: "l1"
      }

      l1 = %{@first_layer_issue | next_layers: [l2]}

      iss_record = %{"id" => @base_uuid_2, "in_shape" => "t", "project_id" => @base_uuid_1}
      proj_record = %{"id" => @base_uuid_1, "in_shape" => "t", "unrelated" => "1"}

      iss_id = ChangeProcessing.id(iss_record, l1.target_table, l1.target_pk)
      proj_id = ChangeProcessing.id(proj_record, l2.target_table, l2.target_pk)

      graph =
        Graph.new()
        |> ChangeProcessing.add_to_graph(l1, iss_record)
        |> ChangeProcessing.add_to_graph(l2, proj_record, iss_id)

      new_record = %{"id" => @base_uuid_2, "in_shape" => "f", "project_id" => @base_uuid_1}

      e1 = %UpdatedRecord{
        relation: @rel_iss,
        old_record: iss_record,
        record: new_record
      }

      base = reduction(graph: graph)

      # Processing
      assert reduction(graph: new_graph, operations: operations, gone_nodes: gone) =
               ChangeProcessing.process(e1, l1, base)

      # Assertions
      refute ChangeProcessing.row_in_graph?(new_graph, iss_id, l1.key)
      refute ChangeProcessing.row_in_graph?(new_graph, proj_id, l2.key)
      assert %{e1 => :deleted_record} == operations
      assert MapSet.new([proj_id]) == gone
    end

    test "two layers, one-to-many, child in graph, parent in graph" do
      # Setup: layer, current graph, and actual event
      l2 = %Layer{
        direction: :one_to_many,
        source_table: @rel_proj,
        source_pk: ["id"],
        target_table: @rel_iss,
        target_pk: ["id"],
        key: "l2",
        fk: ["project_id"],
        parent_key: "l1"
      }

      l1 = %{@first_layer_project | next_layers: [l2]}

      iss_record = %{
        "id" => @base_uuid_2,
        "in_shape" => "t",
        "project_id" => @base_uuid_1,
        "unrelated" => "1"
      }

      proj_record = %{"id" => @base_uuid_1, "in_shape" => "t"}

      iss_id = ChangeProcessing.id(iss_record, l2.target_table, l2.target_pk)
      proj_id = ChangeProcessing.id(proj_record, l1.target_table, l1.target_pk)

      graph =
        Graph.new()
        |> ChangeProcessing.add_to_graph(l1, proj_record)
        |> ChangeProcessing.add_to_graph(l2, iss_record, proj_id)

      event = %UpdatedRecord{
        relation: @rel_iss,
        old_record: iss_record,
        record: %{iss_record | "unrelated" => "2"}
      }

      base = reduction(graph: graph)

      # Processing
      assert reduction(graph: new_graph, operations: operations, actions: actions) =
               ChangeProcessing.process(event, l2, base)

      # Assertions
      assert graph == new_graph
      assert ChangeProcessing.row_in_graph?(new_graph, iss_id, l2.key)
      assert %{event => :updated_record} == operations
      assert %{} == actions
    end

    test "two layers, one-to-many, parent in graph, child moves in based on where clause" do
      # Setup: layer, current graph, and actual event
      l2 = %Layer{
        direction: :one_to_many,
        source_table: @rel_proj,
        source_pk: ["id"],
        target_table: @rel_iss,
        target_pk: ["id"],
        key: "l2",
        fk: ["project_id"],
        parent_key: "l1",
        where_target: @base_where
      }

      l1 = %{@first_layer_project | next_layers: [l2]}

      iss_record = %{"id" => @base_uuid_2, "in_shape" => "f", "project_id" => @base_uuid_1}
      proj_record = %{"id" => @base_uuid_1, "in_shape" => "t"}

      iss_id = ChangeProcessing.id(iss_record, l2.target_table, l2.target_pk)

      graph =
        Graph.new()
        |> ChangeProcessing.add_to_graph(l1, proj_record)

      event = %UpdatedRecord{
        relation: @rel_iss,
        old_record: iss_record,
        record: %{iss_record | "in_shape" => "t"}
      }

      base = reduction(graph: graph)

      # Processing
      assert reduction(graph: new_graph, operations: operations, actions: actions) =
               ChangeProcessing.process(event, l2, base)

      # Assertions
      assert ChangeProcessing.row_in_graph?(new_graph, iss_id, l2.key)
      assert %{event => :new_record} == operations
      assert %{} == actions
    end

    test "two layers, one-to-many, parent not in graph, child moves in based on where clause + parent insert" do
      # Setup: layer, current graph, and actual event
      l2 = %Layer{
        direction: :one_to_many,
        source_table: @rel_proj,
        source_pk: ["id"],
        target_table: @rel_iss,
        target_pk: ["id"],
        key: "l2",
        fk: ["project_id"],
        parent_key: "l1",
        where_target: @base_where
      }

      l1 = %{@first_layer_project | next_layers: [l2]}

      iss_record = %{"id" => @base_uuid_2, "in_shape" => "f", "project_id" => @base_uuid_1}
      proj_record = %{"id" => @base_uuid_1, "in_shape" => "f"}

      iss_id = ChangeProcessing.id(iss_record, l2.target_table, l2.target_pk)
      proj_id = ChangeProcessing.id(proj_record, l1.target_table, l1.target_pk)

      graph = Graph.new()

      e1 = %UpdatedRecord{
        relation: @rel_iss,
        old_record: iss_record,
        record: %{iss_record | "in_shape" => "t"}
      }

      e2 = %UpdatedRecord{
        relation: @rel_proj,
        old_record: proj_record,
        record: %{proj_record | "in_shape" => "t"}
      }

      base = reduction(graph: graph)

      # Processing
      assert reduction(graph: new_graph, operations: operations, actions: actions) =
               state =
               ChangeProcessing.process(e1, l2, base)

      # Assertions
      refute ChangeProcessing.row_in_graph?(new_graph, iss_id, l2.key)
      assert %{} == operations
      assert %{} == actions

      # Parent processing
      assert reduction(graph: new_graph, operations: operations) =
               ChangeProcessing.process(e2, l1, state)

      # Assertions
      assert ChangeProcessing.row_in_graph?(new_graph, proj_id, l1.key)
      assert ChangeProcessing.row_in_graph?(new_graph, iss_id, l2.key)

      assert %{e1 => :new_record, e2 => :new_record} == operations
    end

    test "two layers, one-to-many, parent in graph, child moves out based on where clause" do
      # Setup: layer, current graph, and actual event
      l2 = %Layer{
        direction: :one_to_many,
        source_table: @rel_proj,
        source_pk: ["id"],
        target_table: @rel_iss,
        target_pk: ["id"],
        key: "l2",
        fk: ["project_id"],
        parent_key: "l1",
        where_target: @base_where
      }

      l1 = %{@first_layer_project | next_layers: [l2]}

      iss_record = %{"id" => @base_uuid_2, "in_shape" => "t", "project_id" => @base_uuid_1}
      proj_record = %{"id" => @base_uuid_1, "in_shape" => "t"}

      iss_id = ChangeProcessing.id(iss_record, l2.target_table, l2.target_pk)
      proj_id = ChangeProcessing.id(proj_record, l1.target_table, l1.target_pk)

      graph =
        Graph.new()
        |> ChangeProcessing.add_to_graph(l1, proj_record)
        |> ChangeProcessing.add_to_graph(l2, iss_record, proj_id)

      event = %UpdatedRecord{
        relation: @rel_iss,
        old_record: iss_record,
        record: %{iss_record | "in_shape" => "f"}
      }

      base = reduction(graph: graph)

      # Processing
      assert reduction(graph: new_graph, operations: operations, actions: actions) =
               ChangeProcessing.process(event, l2, base)

      # Assertions
      refute ChangeProcessing.row_in_graph?(new_graph, iss_id, l2.key)
      assert %{event => :deleted_record} == operations
      assert %{} == actions
    end

    test "two layers, one-to-many, child moves between 2 parents in the same layer, original parent gone" do
      # Setup: layer, current graph, and actual event
      l2 = %Layer{
        direction: :one_to_many,
        source_table: @rel_proj,
        source_pk: ["id"],
        target_table: @rel_iss,
        target_pk: ["id"],
        key: "l2",
        fk: ["project_id"],
        parent_key: "l1",
        where_target: @base_where
      }

      l1 = %{@first_layer_project | next_layers: [l2]}

      iss_record = %{"id" => @base_uuid_2, "in_shape" => "t", "project_id" => @base_uuid_1}
      proj1_record = %{"id" => @base_uuid_1, "in_shape" => "t"}
      proj2_record = %{"id" => @base_uuid_3, "in_shape" => "t"}

      iss_id = ChangeProcessing.id(iss_record, l2.target_table, l2.target_pk)
      proj1_id = ChangeProcessing.id(proj1_record, l1.target_table, l1.target_pk)

      graph =
        Graph.new()
        |> ChangeProcessing.add_to_graph(l1, proj1_record)
        |> ChangeProcessing.add_to_graph(l1, proj2_record)
        |> ChangeProcessing.add_to_graph(l2, iss_record, proj1_id)

      e1 = %UpdatedRecord{
        relation: @rel_iss,
        old_record: iss_record,
        record: %{iss_record | "project_id" => @base_uuid_3}
      }

      e2 = %UpdatedRecord{
        relation: @rel_proj,
        old_record: proj1_record,
        record: %{proj1_record | "in_shape" => "f"}
      }

      base = reduction(graph: graph)

      # Processing
      state =
        ChangeProcessing.process(e1, l2, base)

      assert reduction(graph: new_graph, operations: operations, actions: actions) =
               ChangeProcessing.process(e2, l1, state)

      # Assertions
      assert ChangeProcessing.row_in_graph?(new_graph, iss_id, l2.key)
      assert %{e1 => :updated_record, e2 => :deleted_record} == operations
      assert %{} == actions
    end

    test "two layers, one-to-many, child changes parent to one not in shape" do
      # Setup: layer, current graph, and actual event
      l2 = %Layer{
        direction: :one_to_many,
        source_table: @rel_proj,
        source_pk: ["id"],
        target_table: @rel_iss,
        target_pk: ["id"],
        key: "l2",
        fk: ["project_id"],
        parent_key: "l1",
        where_target: @base_where
      }

      l1 = %{@first_layer_project | next_layers: [l2]}

      iss_record = %{"id" => @base_uuid_2, "in_shape" => "t", "project_id" => @base_uuid_1}
      proj1_record = %{"id" => @base_uuid_1, "in_shape" => "t"}
      proj2_record = %{"id" => @base_uuid_3, "in_shape" => "f"}

      iss_id = ChangeProcessing.id(iss_record, l2.target_table, l2.target_pk)
      proj1_id = ChangeProcessing.id(proj1_record, l1.target_table, l1.target_pk)
      proj2_id = ChangeProcessing.id(proj2_record, l1.target_table, l1.target_pk)

      graph =
        Graph.new()
        |> ChangeProcessing.add_to_graph(l1, proj1_record)
        |> ChangeProcessing.add_to_graph(l2, iss_record, proj1_id)

      e1 = %UpdatedRecord{
        relation: @rel_iss,
        old_record: iss_record,
        record: %{iss_record | "project_id" => @base_uuid_3}
      }

      base = reduction(graph: graph)

      # Processing

      assert reduction(graph: new_graph, operations: operations, actions: actions) =
               ChangeProcessing.process(e1, l2, base)
               |> ChangeProcessing.finalize_process()

      # Assertions
      refute ChangeProcessing.row_in_graph?(new_graph, iss_id, l2.key)
      refute Graph.has_vertex?(new_graph, proj2_id)
      assert %{e1 => :deleted_record} == operations
      assert %{} == actions
    end

    test "two layers, one-to-many, parent move-in causes a fetch" do
      # Setup: layer, current graph, and actual event
      l2 = %Layer{
        direction: :one_to_many,
        source_table: @rel_proj,
        source_pk: ["id"],
        target_table: @rel_iss,
        target_pk: ["id"],
        key: "l2",
        fk: ["project_id"],
        parent_key: "l1",
        where_target: @base_where
      }

      layer = %{@first_layer_project | next_layers: [l2]}

      record = %{"id" => @base_uuid_1, "in_shape" => "f"}
      new_record = %{"id" => @base_uuid_1, "in_shape" => "t"}

      graph = Graph.new()

      event = %UpdatedRecord{
        relation: @rel_proj,
        old_record: record,
        record: new_record
      }

      base = reduction(graph: graph)

      # Processing
      assert reduction(graph: new_graph, operations: operations, actions: actions) =
               ChangeProcessing.process(event, layer, base)

      # Assertions
      id = ChangeProcessing.id(event.record, layer.target_table, layer.target_pk)

      assert ChangeProcessing.row_in_graph?(new_graph, id, layer.key)
      assert %{event => :new_record} == operations
      assert %{layer => [{id, event.record}]} == actions
    end

    test "two layers, parent move-out supersedes the child update regardless of order" do
      # Setup: layer, current graph, and actual event
      l2 = %Layer{
        direction: :one_to_many,
        source_table: @rel_proj,
        source_pk: ["id"],
        target_table: @rel_iss,
        target_pk: ["id"],
        key: "l2",
        fk: ["project_id"],
        parent_key: "l1",
        where_target: @base_where
      }

      l1 = %{@first_layer_project | next_layers: [l2]}

      proj_record = %{"id" => @base_uuid_1, "in_shape" => "t"}

      iss_record = %{
        "id" => @base_uuid_2,
        "in_shape" => "t",
        "project_id" => @base_uuid_1,
        "unrelated" => 1
      }

      id1 = ChangeProcessing.id(proj_record, l1.target_table, l1.target_pk)
      id2 = ChangeProcessing.id(iss_record, l2.target_table, l2.target_pk)

      graph =
        Graph.new()
        |> ChangeProcessing.add_to_graph(l1, proj_record)
        |> ChangeProcessing.add_to_graph(l2, iss_record, proj_record)

      e1 = %UpdatedRecord{
        relation: @rel_proj,
        old_record: proj_record,
        record: %{proj_record | "in_shape" => "f"}
      }

      e2 = %UpdatedRecord{
        relation: @rel_iss,
        old_record: iss_record,
        record: %{iss_record | "unrelated" => 2}
      }

      base = reduction(graph: graph)

      # Processing, move-out first
      new_state = ChangeProcessing.process(e1, l1, base)

      assert reduction(graph: new_graph, operations: operations, gone_nodes: gone) =
               ChangeProcessing.process(e2, l2, new_state)

      # Assertions
      refute ChangeProcessing.row_in_graph?(new_graph, id1, l1.key)
      refute ChangeProcessing.row_in_graph?(new_graph, id2, l2.key)
      assert MapSet.member?(gone, id2)
      assert %{e1 => :deleted_record} == operations

      # Processing, update first
      new_state = ChangeProcessing.process(e2, l2, base)

      assert reduction(graph: new_graph, operations: operations, gone_nodes: gone) =
               ChangeProcessing.process(e1, l1, new_state)

      # Assertions
      refute ChangeProcessing.row_in_graph?(new_graph, id1, l1.key)
      refute ChangeProcessing.row_in_graph?(new_graph, id2, l2.key)
      assert MapSet.member?(gone, id2)
      assert %{e1 => :deleted_record} == operations
    end

    test "two layers, parent move-out supersedes the child insert regardless of order" do
      # Setup: layer, current graph, and actual event
      l2 = %Layer{
        direction: :one_to_many,
        source_table: @rel_proj,
        source_pk: ["id"],
        target_table: @rel_iss,
        target_pk: ["id"],
        key: "l2",
        fk: ["project_id"],
        parent_key: "l1",
        where_target: @base_where
      }

      l1 = %{@first_layer_project | next_layers: [l2]}

      proj_record = %{"id" => @base_uuid_1, "in_shape" => "t"}

      iss_record = %{
        "id" => @base_uuid_2,
        "in_shape" => "t",
        "project_id" => @base_uuid_1,
        "unrelated" => 1
      }

      id1 = ChangeProcessing.id(proj_record, l1.target_table, l1.target_pk)
      id2 = ChangeProcessing.id(iss_record, l2.target_table, l2.target_pk)

      graph =
        Graph.new()
        |> ChangeProcessing.add_to_graph(l1, proj_record)

      e1 = %UpdatedRecord{
        relation: @rel_proj,
        old_record: proj_record,
        record: %{proj_record | "in_shape" => "f"}
      }

      e2 = %NewRecord{
        relation: @rel_iss,
        record: iss_record
      }

      base = reduction(graph: graph)

      # Processing, move-out first
      new_state = ChangeProcessing.process(e1, l1, base)

      assert reduction(graph: new_graph, operations: operations, gone_nodes: gone) =
               ChangeProcessing.process(e2, l2, new_state)

      # Assertions
      refute ChangeProcessing.row_in_graph?(new_graph, id1, l1.key)
      refute ChangeProcessing.row_in_graph?(new_graph, id2, l2.key)
      # Never seen, cannot be GONE
      refute MapSet.member?(gone, id2)
      assert %{e1 => :deleted_record} == operations

      # Processing, update first
      new_state = ChangeProcessing.process(e2, l2, base)

      assert reduction(graph: new_graph, operations: operations, gone_nodes: gone) =
               ChangeProcessing.process(e1, l1, new_state)

      # Assertions
      refute ChangeProcessing.row_in_graph?(new_graph, id1, l1.key)
      refute ChangeProcessing.row_in_graph?(new_graph, id2, l2.key)
      # Never seen, cannot be GONE
      refute MapSet.member?(gone, id2)
      assert %{e1 => :deleted_record} == operations
    end
  end
end
