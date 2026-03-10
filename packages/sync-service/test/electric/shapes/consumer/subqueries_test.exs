defmodule Electric.Shapes.Consumer.SubqueriesTest do
  use ExUnit.Case, async: true

  alias Electric.Postgres.Lsn
  alias Electric.Replication.Changes
  alias Electric.Replication.Changes.Transaction
  alias Electric.Shapes.Consumer.Subqueries
  alias Electric.Shapes.Consumer.Subqueries.Buffering
  alias Electric.Shapes.Consumer.Subqueries.Steady
  alias Electric.Shapes.Shape

  @inspector Support.StubInspector.new(
               tables: ["parent", "child"],
               columns: [
                 %{name: "id", type: "int8", pk_position: 0, type_id: {20, 1}},
                 %{name: "value", type: "text", pk_position: nil, type_id: {28, 1}},
                 %{name: "parent_id", type: "int8", pk_position: nil, type_id: {20, 1}},
                 %{name: "name", type: "text", pk_position: nil, type_id: {28, 1}}
               ]
             )

  test "converts steady transactions against the current subquery view" do
    state = new_state(subquery_view: MapSet.new([1]))

    {changes, state} =
      Subqueries.handle_event(
        state,
        txn(50, [child_insert("1", "1"), child_insert("2", "2")])
      )

    assert %Steady{} = state
    assert [%Changes.NewRecord{record: %{"id" => "1"}, last?: true}] = changes
  end

  test "splices buffered transactions around the snapshot visibility boundary" do
    state = new_state()
    dep_handle = state.dependency_handle

    {[], state} =
      Subqueries.handle_event(
        state,
        {:materializer_changes, dep_handle, %{move_in: [{1, "1"}], move_out: []}}
      )

    assert %Buffering{} = state

    {[], state} = Subqueries.handle_event(state, txn(50, [child_insert("10", "1")]))
    {[], state} = Subqueries.handle_event(state, {:pg_snapshot_known, {100, 150, []}})
    {[], state} = Subqueries.handle_event(state, txn(150, [child_insert("11", "1")]))

    query_row = child_insert("99", "1")

    {changes, state} =
      Subqueries.handle_event(state, {:query_move_in_complete, [query_row], lsn(10)})

    assert %Steady{subquery_view: view} = state
    assert view == MapSet.new([1])

    assert [
             %Changes.NewRecord{record: %{"id" => "99"}},
             %Changes.NewRecord{record: %{"id" => "11"}, last?: true}
           ] = changes
  end

  test "splices move-in query rows between emitted pre and post boundary changes" do
    state = new_state(subquery_view: MapSet.new([1]))
    dep_handle = state.dependency_handle

    {[], state} =
      Subqueries.handle_event(
        state,
        {:materializer_changes, dep_handle, %{move_in: [{2, "2"}], move_out: []}}
      )

    {[], state} = Subqueries.handle_event(state, txn(50, [child_insert("10", "1")]))
    {[], state} = Subqueries.handle_event(state, {:pg_snapshot_known, {100, 150, []}})
    {[], state} = Subqueries.handle_event(state, txn(150, [child_insert("11", "2")]))

    {changes, state} =
      Subqueries.handle_event(
        state,
        {:query_move_in_complete, [child_insert("99", "2")], lsn(10)}
      )

    assert %Steady{subquery_view: view} = state
    assert view == MapSet.new([1, 2])

    assert [
             %Changes.NewRecord{record: %{"id" => "10"}},
             %Changes.NewRecord{record: %{"id" => "99"}},
             %Changes.NewRecord{record: %{"id" => "11"}, last?: true}
           ] = changes
  end

  test "splices updates that become a delete before the boundary and an insert after it" do
    state = new_state(subquery_view: MapSet.new([1]))
    dep_handle = state.dependency_handle

    {[], state} =
      Subqueries.handle_event(
        state,
        {:materializer_changes, dep_handle, %{move_in: [{2, "2"}], move_out: []}}
      )

    # Before the splice we still evaluate against the old view {1}, so moving
    # from parent 1 to parent 2 means the row leaves the shape and becomes a delete.
    {[], state} = Subqueries.handle_event(state, txn(50, [child_update("10", "1", "2")]))

    # After the splice we evaluate against the new view {1, 2}, so moving from
    # parent 3 to parent 2 means the row enters the shape and becomes a new record.
    {[], state} = Subqueries.handle_event(state, txn(150, [child_update("11", "3", "2")]))

    {[], state} = Subqueries.handle_event(state, {:pg_snapshot_known, {100, 150, []}})

    {changes, state} =
      Subqueries.handle_event(
        state,
        {:query_move_in_complete, [child_insert("99", "2")], lsn(10)}
      )

    assert %Steady{subquery_view: view} = state
    assert view == MapSet.new([1, 2])

    assert [
             %Changes.DeletedRecord{old_record: %{"id" => "10"}},
             %Changes.NewRecord{record: %{"id" => "99"}},
             %Changes.NewRecord{record: %{"id" => "11"}, last?: true}
           ] = changes
  end

  test "uses lsn updates to splice at the current buffer tail" do
    state = new_state()
    dep_handle = state.dependency_handle

    {[], state} =
      Subqueries.handle_event(
        state,
        {:materializer_changes, dep_handle, %{move_in: [{1, "1"}], move_out: []}}
      )

    {[], state} = Subqueries.handle_event(state, txn(120, [child_insert("10", "1")]))
    {[], state} = Subqueries.handle_event(state, {:pg_snapshot_known, {100, 300, []}})

    {[], state} =
      Subqueries.handle_event(
        state,
        {:query_move_in_complete, [child_insert("99", "1")], lsn(20)}
      )

    {changes, state} = Subqueries.handle_event(state, %Changes.LsnUpdate{lsn: lsn(20)})

    assert %Steady{subquery_view: view} = state
    assert view == MapSet.new([1])
    assert [%Changes.NewRecord{record: %{"id" => "99"}}] = changes
  end

  test "splices buffered inserts, updates, and deletes around an lsn boundary" do
    state = new_state()
    dep_handle = state.dependency_handle

    {[], state} =
      Subqueries.handle_event(
        state,
        {:materializer_changes, dep_handle, %{move_in: [{1, "1"}], move_out: []}}
      )

    {[], state} =
      Subqueries.handle_event(
        state,
        txn(120, [
          child_insert("10", "1"),
          child_update("20", "1"),
          child_delete("30", "1")
        ])
      )

    {[], state} =
      Subqueries.handle_event(
        state,
        {:query_move_in_complete, [child_insert("99", "1")], lsn(20)}
      )

    {[], state} = Subqueries.handle_event(state, %Changes.LsnUpdate{lsn: lsn(20)})

    {[], state} =
      Subqueries.handle_event(
        state,
        txn(150, [
          child_insert("11", "1"),
          child_update("21", "1"),
          child_delete("31", "1")
        ])
      )

    {changes, state} = Subqueries.handle_event(state, {:pg_snapshot_known, {100, 300, []}})

    assert %Steady{subquery_view: view} = state
    assert view == MapSet.new([1])

    assert [
             %Changes.NewRecord{record: %{"id" => "99"}},
             %Changes.NewRecord{record: %{"id" => "11"}},
             %Changes.UpdatedRecord{record: %{"id" => "21"}},
             %Changes.DeletedRecord{old_record: %{"id" => "31"}, last?: true}
           ] = changes
  end

  test "keeps the transaction splice boundary when a later lsn update arrives" do
    state = new_state()
    dep_handle = state.dependency_handle

    {[], state} =
      Subqueries.handle_event(
        state,
        {:materializer_changes, dep_handle, %{move_in: [{1, "1"}], move_out: []}}
      )

    {[], state} = Subqueries.handle_event(state, txn(50, [child_insert("10", "1")]))
    {[], state} = Subqueries.handle_event(state, {:pg_snapshot_known, {100, 150, []}})
    {[], state} = Subqueries.handle_event(state, txn(150, [child_insert("11", "1")]))
    {[], state} = Subqueries.handle_event(state, txn(160, [child_insert("12", "1")]))
    {[], state} = Subqueries.handle_event(state, %Changes.LsnUpdate{lsn: lsn(20)})

    {changes, state} =
      Subqueries.handle_event(
        state,
        {:query_move_in_complete, [child_insert("99", "1")], lsn(20)}
      )

    assert %Steady{subquery_view: view} = state
    assert view == MapSet.new([1])

    assert [
             %Changes.NewRecord{record: %{"id" => "99"}},
             %Changes.NewRecord{record: %{"id" => "11"}},
             %Changes.NewRecord{record: %{"id" => "12"}, last?: true}
           ] = changes
  end

  test "keeps the lsn splice boundary when the snapshot later reveals invisible txns" do
    state = new_state()
    dep_handle = state.dependency_handle

    {[], state} =
      Subqueries.handle_event(
        state,
        {:materializer_changes, dep_handle, %{move_in: [{1, "1"}], move_out: []}}
      )

    {[], state} =
      Subqueries.handle_event(
        state,
        {:query_move_in_complete, [child_insert("99", "1")], lsn(20)}
      )

    {[], state} = Subqueries.handle_event(state, %Changes.LsnUpdate{lsn: lsn(20)})
    {[], state} = Subqueries.handle_event(state, txn(50, [child_insert("10", "1")]))
    {[], state} = Subqueries.handle_event(state, txn(150, [child_insert("11", "1")]))

    {changes, state} = Subqueries.handle_event(state, {:pg_snapshot_known, {100, 150, []}})

    assert %Steady{subquery_view: view} = state
    assert view == MapSet.new([1])

    assert [
             %Changes.NewRecord{record: %{"id" => "99"}},
             %Changes.NewRecord{record: %{"id" => "10"}},
             %Changes.NewRecord{record: %{"id" => "11"}, last?: true}
           ] = changes
  end

  test "waits for an lsn update even when the move-in query completes with an empty buffer" do
    state = new_state()
    dep_handle = state.dependency_handle

    {[], state} =
      Subqueries.handle_event(
        state,
        {:materializer_changes, dep_handle, %{move_in: [{1, "1"}], move_out: []}}
      )

    {[], state} = Subqueries.handle_event(state, {:pg_snapshot_known, {100, 300, []}})

    {[], state} =
      Subqueries.handle_event(
        state,
        {:query_move_in_complete, [child_insert("99", "1")], lsn(20)}
      )

    assert %Buffering{} = state

    {changes, state} = Subqueries.handle_event(state, %Changes.LsnUpdate{lsn: lsn(20)})

    assert %Steady{subquery_view: view} = state
    assert view == MapSet.new([1])
    assert [%Changes.NewRecord{record: %{"id" => "99"}}] = changes
  end

  test "uses an lsn update that arrived before the move-in query completed" do
    state = new_state()
    dep_handle = state.dependency_handle

    {[], state} =
      Subqueries.handle_event(
        state,
        {:materializer_changes, dep_handle, %{move_in: [{1, "1"}], move_out: []}}
      )

    {[], state} = Subqueries.handle_event(state, {:pg_snapshot_known, {100, 300, []}})
    {[], state} = Subqueries.handle_event(state, %Changes.LsnUpdate{lsn: lsn(20)})

    {changes, state} =
      Subqueries.handle_event(
        state,
        {:query_move_in_complete, [child_insert("99", "1")], lsn(20)}
      )

    assert %Steady{subquery_view: view} = state
    assert view == MapSet.new([1])
    assert [%Changes.NewRecord{record: %{"id" => "99"}}] = changes
  end

  test "uses an lsn update that was already seen before the move-in started" do
    state = new_state()
    dep_handle = state.dependency_handle

    {[], state} = Subqueries.handle_event(state, %Changes.LsnUpdate{lsn: lsn(20)})

    {[], state} =
      Subqueries.handle_event(
        state,
        {:materializer_changes, dep_handle, %{move_in: [{1, "1"}], move_out: []}}
      )

    {[], state} = Subqueries.handle_event(state, {:pg_snapshot_known, {100, 300, []}})

    {changes, state} =
      Subqueries.handle_event(
        state,
        {:query_move_in_complete, [child_insert("99", "1")], lsn(20)}
      )

    assert %Steady{subquery_view: view} = state
    assert view == MapSet.new([1])
    assert [%Changes.NewRecord{record: %{"id" => "99"}}] = changes
  end

  test "defers queued move outs until after splice and starts the next move in" do
    state = new_state()
    dep_handle = state.dependency_handle

    {[], state} =
      Subqueries.handle_event(
        state,
        {:materializer_changes, dep_handle, %{move_in: [{1, "1"}], move_out: []}}
      )

    {[], state} =
      Subqueries.handle_event(
        state,
        {:materializer_changes, dep_handle, %{move_in: [{2, "2"}], move_out: [{1, "1"}]}}
      )

    {[], state} = Subqueries.handle_event(state, {:pg_snapshot_known, {100, 200, []}})

    {[], state} =
      Subqueries.handle_event(
        state,
        {:query_move_in_complete, [child_insert("99", "1")], lsn(10)}
      )

    {changes, state} = Subqueries.handle_event(state, %Changes.LsnUpdate{lsn: lsn(10)})

    assert %Buffering{
             move_in_values: [{2, "2"}],
             subquery_view_before_move_in: view_before,
             subquery_view_after_move_in: view_after
           } = state

    assert view_before == MapSet.new()
    assert view_after == MapSet.new([2])

    assert [
             %Changes.NewRecord{record: %{"id" => "99"}},
             %{headers: %{event: "move-out", patterns: [%{pos: 0}]}}
           ] = changes
  end

  test "applies a queued move out for the active move-in value after splice" do
    state = new_state()
    dep_handle = state.dependency_handle

    {[], state} =
      Subqueries.handle_event(
        state,
        {:materializer_changes, dep_handle, %{move_in: [{1, "1"}], move_out: []}}
      )

    {[], state} =
      Subqueries.handle_event(
        state,
        {:materializer_changes, dep_handle, %{move_in: [], move_out: [{1, "1"}]}}
      )

    {[], state} = Subqueries.handle_event(state, {:pg_snapshot_known, {100, 200, []}})

    {[], state} =
      Subqueries.handle_event(
        state,
        {:query_move_in_complete, [child_insert("99", "1")], lsn(10)}
      )

    {changes, state} = Subqueries.handle_event(state, %Changes.LsnUpdate{lsn: lsn(10)})

    assert %Steady{subquery_view: view} = state
    assert view == MapSet.new()

    assert [
             %Changes.NewRecord{record: %{"id" => "99"}},
             %{headers: %{event: "move-out", patterns: [%{pos: 0}]}}
           ] = changes
  end

  test "batches consecutive move ins into a single active move in" do
    state = new_state()
    dep_handle = state.dependency_handle

    {[], state} =
      Subqueries.handle_event(
        state,
        {:materializer_changes, dep_handle, %{move_in: [{1, "1"}, {2, "2"}], move_out: []}}
      )

    assert %Buffering{
             move_in_values: [{1, "1"}, {2, "2"}],
             subquery_view_before_move_in: before_view,
             subquery_view_after_move_in: after_view
           } = state

    assert before_view == MapSet.new()
    assert after_view == MapSet.new([1, 2])
  end

  test "cancels pending inverse ops while buffering" do
    state = new_state()
    dep_handle = state.dependency_handle

    {[], state} =
      Subqueries.handle_event(
        state,
        {:materializer_changes, dep_handle, %{move_in: [{1, "1"}], move_out: []}}
      )

    {[], state} =
      Subqueries.handle_event(
        state,
        {:materializer_changes, dep_handle, %{move_in: [{2, "2"}], move_out: []}}
      )

    {[], state} =
      Subqueries.handle_event(
        state,
        {:materializer_changes, dep_handle, %{move_in: [], move_out: [{2, "2"}]}}
      )

    {[], state} = Subqueries.handle_event(state, {:pg_snapshot_known, {100, 200, []}})

    {[], state} =
      Subqueries.handle_event(
        state,
        {:query_move_in_complete, [child_insert("99", "1")], lsn(10)}
      )

    {changes, state} = Subqueries.handle_event(state, %Changes.LsnUpdate{lsn: lsn(10)})

    assert %Steady{subquery_view: view} = state
    assert view == MapSet.new([1])
    assert [%Changes.NewRecord{record: %{"id" => "99"}}] = changes
  end

  test "merges queued move outs into a single control message after splice" do
    state = new_state(subquery_view: MapSet.new([2]))
    dep_handle = state.dependency_handle

    {[], state} =
      Subqueries.handle_event(
        state,
        {:materializer_changes, dep_handle, %{move_in: [{1, "1"}], move_out: []}}
      )

    {[], state} =
      Subqueries.handle_event(
        state,
        {:materializer_changes, dep_handle, %{move_in: [], move_out: [{1, "1"}]}}
      )

    {[], state} =
      Subqueries.handle_event(
        state,
        {:materializer_changes, dep_handle, %{move_in: [], move_out: [{2, "2"}]}}
      )

    {[], state} = Subqueries.handle_event(state, {:pg_snapshot_known, {100, 200, []}})

    {[], state} =
      Subqueries.handle_event(
        state,
        {:query_move_in_complete, [child_insert("99", "1")], lsn(10)}
      )

    {changes, state} = Subqueries.handle_event(state, %Changes.LsnUpdate{lsn: lsn(10)})

    assert %Steady{subquery_view: view} = state
    assert view == MapSet.new()

    assert [
             %Changes.NewRecord{record: %{"id" => "99"}},
             %{headers: %{event: "move-out", patterns: patterns}}
           ] = changes

    assert length(patterns) == 2
  end

  test "raises on dependency handle mismatch" do
    assert_raise ArgumentError, ~r/expected dependency handle/, fn ->
      new_state()
      |> Subqueries.handle_event({:materializer_changes, "wrong", %{move_in: [], move_out: []}})
    end
  end

  test "raises on query callbacks while steady" do
    state = new_state()

    assert_raise ArgumentError, ~r/no move-in is buffering/, fn ->
      Subqueries.handle_event(state, {:pg_snapshot_known, {100, 200, []}})
    end

    assert_raise ArgumentError, ~r/no move-in is buffering/, fn ->
      Subqueries.handle_event(state, {:query_move_in_complete, [], lsn(1)})
    end
  end

  test "builds a move-in where clause that excludes the current view" do
    shape = shape()

    assert {where, [[1, 2], [3]]} =
             Subqueries.move_in_where_clause(
               shape,
               hd(shape.shape_dependencies_handles),
               [1, 2],
               MapSet.new([3])
             )

    assert where == "parent_id = ANY ($1::int8[]) AND NOT parent_id = ANY ($2::int8[])"
  end

  test "builds move-out control messages with the current hashing scheme" do
    state = new_state()

    assert %{
             headers: %{
               event: "move-out",
               patterns: [%{pos: 0, value: value}]
             }
           } = Subqueries.make_move_out_control_message(state, [{1, "1"}])

    assert value ==
             :crypto.hash(:md5, "stack-id" <> "shape-handle" <> "v:1")
             |> Base.encode16(case: :lower)
  end

  test "extracts tag structure for the direct subquery predicate" do
    shape = shape()

    assert {[["parent_id"]], %{["$sublink", "0"] => _comparison_expr}} =
             Subqueries.move_in_tag_structure(shape)
  end

  defp new_state(opts \\ []) do
    shape = shape()

    Subqueries.new(
      shape: shape,
      stack_id: "stack-id",
      shape_handle: "shape-handle",
      dependency_handle: hd(shape.shape_dependencies_handles),
      subquery_ref: ["$sublink", "0"],
      subquery_view: Keyword.get(opts, :subquery_view, MapSet.new())
    )
  end

  defp shape do
    Shape.new!("child",
      where: "parent_id IN (SELECT id FROM public.parent WHERE value = 'keep')",
      inspector: @inspector,
      feature_flags: ["allow_subqueries"]
    )
    |> fill_handles()
  end

  defp fill_handles(shape) do
    filled_deps = Enum.map(shape.shape_dependencies, &fill_handles/1)
    handles = Enum.map(filled_deps, &Shape.generate_id/1)
    %{shape | shape_dependencies: filled_deps, shape_dependencies_handles: handles}
  end

  defp txn(xid, changes) do
    %Transaction{xid: xid, changes: changes, num_changes: length(changes), lsn: lsn(xid)}
  end

  defp lsn(value), do: Lsn.from_integer(value)

  defp child_insert(id, parent_id) do
    %Changes.NewRecord{
      relation: {"public", "child"},
      record: %{"id" => id, "parent_id" => parent_id, "name" => "child-#{id}"}
    }
    |> Changes.fill_key(["id"])
  end

  defp child_update(id, parent_id) do
    child_update(id, parent_id, parent_id)
  end

  defp child_update(id, old_parent_id, new_parent_id) do
    Changes.UpdatedRecord.new(
      relation: {"public", "child"},
      old_record: %{"id" => id, "parent_id" => old_parent_id, "name" => "child-#{id}-old"},
      record: %{"id" => id, "parent_id" => new_parent_id, "name" => "child-#{id}-new"}
    )
    |> Changes.fill_key(["id"])
  end

  defp child_delete(id, parent_id) do
    %Changes.DeletedRecord{
      relation: {"public", "child"},
      old_record: %{"id" => id, "parent_id" => parent_id, "name" => "child-#{id}"}
    }
    |> Changes.fill_key(["id"])
  end
end
