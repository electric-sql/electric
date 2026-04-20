defmodule Electric.Shapes.Consumer.EventHandler.SubqueriesTest do
  use ExUnit.Case, async: true

  alias Electric.Postgres.Lsn
  alias Electric.Replication.Changes
  alias Electric.Replication.Changes.Transaction
  alias Electric.Shapes.Consumer.Effects
  alias Electric.Shapes.Consumer.EventHandler
  alias Electric.Shapes.Consumer.EventHandler.Subqueries.Buffering
  alias Electric.Shapes.Consumer.EventHandler.Subqueries.Steady
  alias Electric.Shapes.Consumer.Subqueries.ActiveMove
  alias Electric.Shapes.Consumer.Subqueries.RefResolver
  alias Electric.Shapes.Consumer.Subqueries.ShapeInfo
  alias Electric.Shapes.DnfPlan
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

  describe "Subquery handler" do
    test "converts transactions against the current subquery view" do
      handler = new_handler(subquery_view: MapSet.new([1]))

      assert {:ok, %Steady{}, plan} =
               EventHandler.handle_event(
                 handler,
                 txn(50, [child_insert("1", "1"), child_insert("2", "2")])
               )

      assert [
               %Effects.AppendChanges{
                 changes: [%Changes.NewRecord{record: %{"id" => "1"}, last?: true}]
               },
               %Effects.NotifyFlushed{log_offset: _}
             ] = plan
    end

    test "still converts root transactions when dependency moves are configured to invalidate" do
      handler =
        new_handler(
          subquery_view: MapSet.new([1]),
          dependency_move_policy: :invalidate_on_dependency_move
        )

      assert {:ok, %Steady{}, plan} =
               EventHandler.handle_event(
                 handler,
                 txn(50, [child_insert("1", "1"), child_insert("2", "2")])
               )

      assert [
               %Effects.AppendChanges{
                 changes: [%Changes.NewRecord{record: %{"id" => "1"}, last?: true}]
               },
               %Effects.NotifyFlushed{log_offset: _}
             ] = plan
    end

    test "returns unsupported_subquery when dependency moves are configured to invalidate" do
      handler = new_handler(dependency_move_policy: :invalidate_on_dependency_move)
      dep_handle = dep_handle(handler)

      assert {:error, :unsupported_subquery} =
               EventHandler.handle_event(
                 handler,
                 {:materializer_changes, dep_handle, %{move_in: [{1, "1"}], move_out: []}}
               )
    end

    test "negated subquery turns dependency move-in into an outer move-out" do
      handler = new_handler(shape: negated_shape())
      dep_handle = dep_handle(handler)

      assert {:ok, %Steady{views: %{["$sublink", "0"] => view}} = _handler, plan} =
               EventHandler.handle_event(
                 handler,
                 {:materializer_changes, dep_handle, %{move_in: [{1, "1"}], move_out: []}}
               )

      assert view == MapSet.new([1])

      # Case D: negated move-in completes immediately — effects_for_complete
      # adds the value to the index (deferred to completion for NOT IN broadening)
      assert [
               %Effects.AppendControl{
                 message: %{headers: %{event: "move-out", patterns: [%{pos: 0}]}}
               },
               %Effects.AddToSubqueryIndex{dep_index: 0, values: [{1, "1"}]}
             ] = plan
    end

    test "negated subquery turns dependency move-out into a buffered outer move-in" do
      handler = new_handler(shape: negated_shape(), subquery_view: MapSet.new([1]))
      dep_handle = dep_handle(handler)

      # Case B: negated move-out → remove the value when buffering starts so the
      # negated index reflects the post-move exclusion set while buffering.
      assert {:ok, %Buffering{active_move: %ActiveMove{}} = handler, plan} =
               EventHandler.handle_event(
                 handler,
                 {:materializer_changes, dep_handle, %{move_in: [], move_out: [{1, "1"}]}}
               )

      assert [
               %Effects.SubscribeGlobalLsn{},
               %Effects.RemoveFromSubqueryIndex{dep_index: 0, values: [{1, "1"}]},
               %Effects.StartMoveInQuery{}
             ] = plan

      assert %Buffering{
               active_move: %ActiveMove{
                 views_before_move: %{["$sublink", "0"] => before_view},
                 views_after_move: %{["$sublink", "0"] => after_view}
               }
             } = handler

      assert before_view == MapSet.new([1])
      assert after_view == MapSet.new()

      assert {:ok, %Buffering{active_move: %ActiveMove{}} = handler, []} =
               EventHandler.handle_event(handler, {:pg_snapshot_known, {100, 150, []}})

      assert {:ok, %Buffering{active_move: %ActiveMove{}} = handler, []} =
               EventHandler.handle_event(
                 handler,
                 move_in_complete(lsn(10))
               )

      # Case B: negated move-out → no further index effect at complete because
      # the buffering-start removal already matches the post-splice dependency view.
      assert {:ok, %Steady{views: %{["$sublink", "0"] => view}}, plan} =
               EventHandler.handle_event(handler, global_last_seen_lsn(10))

      assert view == MapSet.new()

      assert [
               %Effects.AppendControl{message: %{headers: %{event: "move-in"}}},
               %Effects.AppendMoveInSnapshot{
                 snapshot_name: "move-in-snapshot",
                 row_count: 1,
                 row_bytes: 100
               },
               %Effects.UnsubscribeGlobalLsn{}
             ] = plan
    end

    test "splices buffered transactions around the snapshot visibility boundary" do
      handler = new_handler()
      dep_handle = dep_handle(handler)

      assert {:ok, %Buffering{active_move: %ActiveMove{}} = handler,
              [
                %Effects.SubscribeGlobalLsn{},
                %Effects.AddToSubqueryIndex{dep_index: 0, values: [{1, "1"}]},
                %Effects.StartMoveInQuery{}
              ]} =
               EventHandler.handle_event(
                 handler,
                 {:materializer_changes, dep_handle, %{move_in: [{1, "1"}], move_out: []}}
               )

      assert {:ok, %Buffering{active_move: %ActiveMove{}} = handler, _plan} =
               EventHandler.handle_event(handler, txn(50, [child_insert("10", "1")]))

      assert {:ok, %Buffering{active_move: %ActiveMove{}} = handler, _plan} =
               EventHandler.handle_event(handler, {:pg_snapshot_known, {100, 150, []}})

      assert {:ok, %Buffering{active_move: %ActiveMove{}} = handler, _plan} =
               EventHandler.handle_event(handler, txn(150, [child_insert("11", "1")]))

      assert {:ok, %Steady{views: views}, plan} =
               EventHandler.handle_event(
                 handler,
                 move_in_complete(lsn(10))
               )

      assert view_for(views) == MapSet.new([1])

      assert [
               %Effects.AppendControl{message: %{headers: %{event: "move-in"}}},
               %Effects.AppendMoveInSnapshot{
                 snapshot_name: "move-in-snapshot",
                 row_count: 1,
                 row_bytes: 100
               },
               %Effects.AppendChanges{
                 changes: [%Changes.NewRecord{record: %{"id" => "11"}, last?: true}]
               },
               %Effects.NotifyFlushed{log_offset: _},
               %Effects.UnsubscribeGlobalLsn{}
             ] = plan
    end

    test "splices move-in query rows between emitted pre and post boundary changes" do
      handler = new_handler(subquery_view: MapSet.new([1]))
      dep_handle = dep_handle(handler)

      assert {:ok, %Buffering{active_move: %ActiveMove{}} = handler, _plan} =
               EventHandler.handle_event(
                 handler,
                 {:materializer_changes, dep_handle, %{move_in: [{2, "2"}], move_out: []}}
               )

      assert {:ok, %Buffering{active_move: %ActiveMove{}} = handler, _plan} =
               EventHandler.handle_event(handler, txn(50, [child_insert("10", "1")]))

      assert {:ok, %Buffering{active_move: %ActiveMove{}} = handler, _plan} =
               EventHandler.handle_event(handler, {:pg_snapshot_known, {100, 150, []}})

      assert {:ok, %Buffering{active_move: %ActiveMove{}} = handler, _plan} =
               EventHandler.handle_event(handler, txn(150, [child_insert("11", "2")]))

      assert {:ok, %Steady{views: views}, plan} =
               EventHandler.handle_event(
                 handler,
                 move_in_complete(lsn(10))
               )

      assert view_for(views) == MapSet.new([1, 2])

      assert [
               %Effects.AppendChanges{
                 changes: [%Changes.NewRecord{record: %{"id" => "10"}}]
               },
               %Effects.AppendControl{message: %{headers: %{event: "move-in"}}},
               %Effects.AppendMoveInSnapshot{
                 snapshot_name: "move-in-snapshot",
                 row_count: 1,
                 row_bytes: 100
               },
               %Effects.AppendChanges{
                 changes: [%Changes.NewRecord{record: %{"id" => "11"}, last?: true}]
               },
               %Effects.NotifyFlushed{log_offset: _},
               %Effects.UnsubscribeGlobalLsn{}
             ] = plan
    end

    test "splices updates that become a delete before the boundary and an insert after it" do
      handler = new_handler(subquery_view: MapSet.new([1]))
      dep_handle = dep_handle(handler)

      assert {:ok, %Buffering{active_move: %ActiveMove{}} = handler, _plan} =
               EventHandler.handle_event(
                 handler,
                 {:materializer_changes, dep_handle, %{move_in: [{2, "2"}], move_out: []}}
               )

      assert {:ok, %Buffering{active_move: %ActiveMove{}} = handler, _plan} =
               EventHandler.handle_event(handler, txn(50, [child_update("10", "1", "2")]))

      assert {:ok, %Buffering{active_move: %ActiveMove{}} = handler, _plan} =
               EventHandler.handle_event(handler, txn(150, [child_update("11", "3", "2")]))

      assert {:ok, %Buffering{active_move: %ActiveMove{}} = handler, _plan} =
               EventHandler.handle_event(handler, {:pg_snapshot_known, {100, 150, []}})

      assert {:ok, %Steady{views: views}, plan} =
               EventHandler.handle_event(
                 handler,
                 move_in_complete(lsn(10))
               )

      assert view_for(views) == MapSet.new([1, 2])

      assert [
               %Effects.AppendChanges{
                 changes: [%Changes.DeletedRecord{old_record: %{"id" => "10"}}]
               },
               %Effects.AppendControl{message: %{headers: %{event: "move-in"}}},
               %Effects.AppendMoveInSnapshot{
                 snapshot_name: "move-in-snapshot",
                 row_count: 1,
                 row_bytes: 100
               },
               %Effects.AppendChanges{
                 changes: [%Changes.NewRecord{record: %{"id" => "11"}, last?: true}]
               },
               %Effects.NotifyFlushed{log_offset: _},
               %Effects.UnsubscribeGlobalLsn{}
             ] = plan
    end

    test "uses lsn updates to splice at the current buffer tail" do
      handler = new_handler()
      dep_handle = dep_handle(handler)

      assert {:ok, %Buffering{active_move: %ActiveMove{}} = handler, _plan} =
               EventHandler.handle_event(
                 handler,
                 {:materializer_changes, dep_handle, %{move_in: [{1, "1"}], move_out: []}}
               )

      assert {:ok, %Buffering{active_move: %ActiveMove{}} = handler, _plan} =
               EventHandler.handle_event(handler, txn(120, [child_insert("10", "1")]))

      assert {:ok, %Buffering{active_move: %ActiveMove{}} = handler, _plan} =
               EventHandler.handle_event(handler, {:pg_snapshot_known, {100, 300, []}})

      assert {:ok, %Buffering{active_move: %ActiveMove{}} = handler, _plan} =
               EventHandler.handle_event(
                 handler,
                 move_in_complete(lsn(20))
               )

      assert {:ok, %Steady{views: views}, plan} =
               EventHandler.handle_event(handler, global_last_seen_lsn(20))

      assert view_for(views) == MapSet.new([1])

      assert [
               %Effects.AppendControl{message: %{headers: %{event: "move-in"}}},
               %Effects.AppendMoveInSnapshot{
                 snapshot_name: "move-in-snapshot",
                 row_count: 1,
                 row_bytes: 100
               },
               %Effects.NotifyFlushed{log_offset: _},
               %Effects.UnsubscribeGlobalLsn{}
             ] = plan
    end

    test "waits for an lsn update even when the move-in query completes with an empty buffer" do
      handler = new_handler()
      dep_handle = dep_handle(handler)

      assert {:ok, %Buffering{active_move: %ActiveMove{}} = handler, _plan} =
               EventHandler.handle_event(
                 handler,
                 {:materializer_changes, dep_handle, %{move_in: [{1, "1"}], move_out: []}}
               )

      assert {:ok, %Buffering{active_move: %ActiveMove{}} = handler, _plan} =
               EventHandler.handle_event(handler, {:pg_snapshot_known, {100, 300, []}})

      assert {:ok, %Buffering{active_move: %ActiveMove{}} = handler, _plan} =
               EventHandler.handle_event(
                 handler,
                 move_in_complete(lsn(20))
               )

      assert {:ok, %Steady{views: views}, plan} =
               EventHandler.handle_event(handler, global_last_seen_lsn(20))

      assert view_for(views) == MapSet.new([1])

      assert [
               %Effects.AppendControl{message: %{headers: %{event: "move-in"}}},
               %Effects.AppendMoveInSnapshot{
                 snapshot_name: "move-in-snapshot",
                 row_count: 1,
                 row_bytes: 100
               },
               %Effects.UnsubscribeGlobalLsn{}
             ] = plan
    end

    test "keeps an empty stored move-in snapshot as an effect so execution can clean it up" do
      handler = new_handler()
      dep_handle = dep_handle(handler)

      assert {:ok, %Buffering{active_move: %ActiveMove{}} = handler, _plan} =
               EventHandler.handle_event(
                 handler,
                 {:materializer_changes, dep_handle, %{move_in: [{1, "1"}], move_out: []}}
               )

      assert {:ok, %Buffering{active_move: %ActiveMove{}} = handler, _plan} =
               EventHandler.handle_event(handler, {:pg_snapshot_known, {100, 300, []}})

      assert {:ok, %Buffering{active_move: %ActiveMove{}} = handler, _plan} =
               EventHandler.handle_event(
                 handler,
                 move_in_complete(lsn(20), row_count: 0, row_bytes: 0)
               )

      assert {:ok, %Steady{views: views}, plan} =
               EventHandler.handle_event(handler, global_last_seen_lsn(20))

      assert view_for(views) == MapSet.new([1])

      assert [
               %Effects.AppendControl{message: %{headers: %{event: "move-in"}}},
               %Effects.AppendMoveInSnapshot{
                 snapshot_name: "move-in-snapshot",
                 row_count: 0,
                 row_bytes: 0
               },
               %Effects.UnsubscribeGlobalLsn{}
             ] = plan
    end

    test "uses an lsn update that arrived before the move-in query completed" do
      handler = new_handler()
      dep_handle = dep_handle(handler)

      assert {:ok, %Buffering{active_move: %ActiveMove{}} = handler, _plan} =
               EventHandler.handle_event(
                 handler,
                 {:materializer_changes, dep_handle, %{move_in: [{1, "1"}], move_out: []}}
               )

      assert {:ok, %Buffering{active_move: %ActiveMove{}} = handler, _plan} =
               EventHandler.handle_event(handler, {:pg_snapshot_known, {100, 300, []}})

      assert {:ok, %Buffering{active_move: %ActiveMove{}} = handler, _plan} =
               EventHandler.handle_event(handler, global_last_seen_lsn(20))

      assert {:ok, %Steady{views: views}, plan} =
               EventHandler.handle_event(
                 handler,
                 move_in_complete(lsn(20))
               )

      assert view_for(views) == MapSet.new([1])

      assert [
               %Effects.AppendControl{message: %{headers: %{event: "move-in"}}},
               %Effects.AppendMoveInSnapshot{
                 snapshot_name: "move-in-snapshot",
                 row_count: 1,
                 row_bytes: 100
               },
               %Effects.UnsubscribeGlobalLsn{}
             ] = plan
    end

    test "keeps the newest seen lsn when an older update arrives later" do
      handler = new_handler()
      dep_handle = dep_handle(handler)

      assert {:ok, %Buffering{active_move: %ActiveMove{}} = handler, _plan} =
               EventHandler.handle_event(
                 handler,
                 {:materializer_changes, dep_handle, %{move_in: [{1, "1"}], move_out: []}}
               )

      assert {:ok, %Buffering{active_move: %ActiveMove{}} = handler, _plan} =
               EventHandler.handle_event(handler, {:pg_snapshot_known, {100, 300, []}})

      assert {:ok, %Buffering{active_move: %ActiveMove{}} = handler, _plan} =
               EventHandler.handle_event(handler, global_last_seen_lsn(20))

      assert {:ok, %Buffering{active_move: %ActiveMove{}} = handler, _plan} =
               EventHandler.handle_event(handler, global_last_seen_lsn(10))

      assert {:ok, %Steady{views: views}, plan} =
               EventHandler.handle_event(
                 handler,
                 move_in_complete(lsn(20))
               )

      assert view_for(views) == MapSet.new([1])

      assert [
               %Effects.AppendControl{message: %{headers: %{event: "move-in"}}},
               %Effects.AppendMoveInSnapshot{
                 snapshot_name: "move-in-snapshot",
                 row_count: 1,
                 row_bytes: 100
               },
               %Effects.UnsubscribeGlobalLsn{}
             ] = plan
    end

    test "defers queued move outs until after splice and starts the next move in" do
      handler = new_handler()
      dep_handle = dep_handle(handler)

      assert {:ok, %Buffering{active_move: %ActiveMove{}} = handler, _plan} =
               EventHandler.handle_event(
                 handler,
                 {:materializer_changes, dep_handle, %{move_in: [{1, "1"}], move_out: []}}
               )

      assert {:ok, %Buffering{active_move: %ActiveMove{}} = handler, []} =
               EventHandler.handle_event(
                 handler,
                 {:materializer_changes, dep_handle, %{move_in: [{2, "2"}], move_out: [{1, "1"}]}}
               )

      assert {:ok, %Buffering{active_move: %ActiveMove{}} = handler, _plan} =
               EventHandler.handle_event(handler, {:pg_snapshot_known, {100, 200, []}})

      assert {:ok, %Buffering{active_move: %ActiveMove{}} = handler, _plan} =
               EventHandler.handle_event(
                 handler,
                 move_in_complete(lsn(10))
               )

      assert {:ok, %Buffering{active_move: %ActiveMove{}} = handler, plan} =
               EventHandler.handle_event(handler, global_last_seen_lsn(10))

      assert %Buffering{
               active_move: %ActiveMove{
                 values: [{2, "2"}],
                 views_before_move: views_before,
                 views_after_move: views_after
               }
             } = handler

      assert view_for(views_before) == MapSet.new()
      assert view_for(views_after) == MapSet.new([2])

      assert [
               %Effects.AppendControl{message: %{headers: %{event: "move-in"}}},
               %Effects.AppendMoveInSnapshot{
                 snapshot_name: "move-in-snapshot",
                 row_count: 1,
                 row_bytes: 100
               },
               %Effects.AppendControl{
                 message: %{headers: %{event: "move-out", patterns: [%{pos: 0}]}}
               },
               %Effects.RemoveFromSubqueryIndex{dep_index: 0, values: [{1, "1"}]},
               %Effects.AddToSubqueryIndex{dep_index: 0, values: [{2, "2"}]},
               %Effects.StartMoveInQuery{}
             ] = plan
    end

    test "queued second move-in emits buffering effects only after it is dequeued" do
      handler = new_handler()
      dep_handle = dep_handle(handler)

      assert {:ok, %Buffering{active_move: %ActiveMove{}} = handler,
              [
                %Effects.SubscribeGlobalLsn{},
                %Effects.AddToSubqueryIndex{dep_index: 0, values: [{1, "1"}]},
                %Effects.StartMoveInQuery{}
              ]} =
               EventHandler.handle_event(
                 handler,
                 {:materializer_changes, dep_handle, %{move_in: [{1, "1"}], move_out: []}}
               )

      assert {:ok, %Buffering{active_move: %ActiveMove{}, queue: queue} = handler, []} =
               EventHandler.handle_event(
                 handler,
                 {:materializer_changes, dep_handle, %{move_in: [{2, "2"}], move_out: []}}
               )

      assert queue.move_in == %{0 => [{2, "2"}]}

      assert {:ok, %Buffering{active_move: %ActiveMove{}} = handler, []} =
               EventHandler.handle_event(handler, {:pg_snapshot_known, {100, 200, []}})

      assert {:ok, %Buffering{active_move: %ActiveMove{}} = handler, []} =
               EventHandler.handle_event(
                 handler,
                 move_in_complete(lsn(10))
               )

      assert {:ok, %Buffering{active_move: %ActiveMove{values: [{2, "2"}]}} = _handler, plan} =
               EventHandler.handle_event(handler, global_last_seen_lsn(10))

      assert [
               %Effects.AppendControl{message: %{headers: %{event: "move-in"}}},
               %Effects.AppendMoveInSnapshot{
                 snapshot_name: "move-in-snapshot",
                 row_count: 1,
                 row_bytes: 100
               },
               %Effects.AddToSubqueryIndex{dep_index: 0, values: [{2, "2"}]},
               %Effects.StartMoveInQuery{}
             ] = plan
    end

    test "chained move-in resolves without needing a new lsn broadcast" do
      handler = new_handler()
      dep_handle = dep_handle(handler)

      assert {:ok, %Buffering{active_move: %ActiveMove{}} = handler, _plan} =
               EventHandler.handle_event(
                 handler,
                 {:materializer_changes, dep_handle, %{move_in: [{1, "1"}], move_out: []}}
               )

      assert {:ok, %Buffering{active_move: %ActiveMove{}} = handler, []} =
               EventHandler.handle_event(
                 handler,
                 {:materializer_changes, dep_handle, %{move_in: [{2, "2"}], move_out: [{1, "1"}]}}
               )

      assert {:ok, %Buffering{active_move: %ActiveMove{}} = handler, _plan} =
               EventHandler.handle_event(handler, {:pg_snapshot_known, {100, 200, []}})

      assert {:ok, %Buffering{active_move: %ActiveMove{}} = handler, _plan} =
               EventHandler.handle_event(
                 handler,
                 move_in_complete(lsn(10))
               )

      # First splice completes, second move-in starts
      assert {:ok, %Buffering{active_move: %ActiveMove{}} = handler, _plan} =
               EventHandler.handle_event(handler, global_last_seen_lsn(10))

      # Second move-in resolves with no further lsn broadcasts
      assert {:ok, %Buffering{active_move: %ActiveMove{}} = handler, _plan} =
               EventHandler.handle_event(handler, {:pg_snapshot_known, {200, 300, []}})

      assert {:ok, %Steady{views: views}, _plan} =
               EventHandler.handle_event(
                 handler,
                 move_in_complete(lsn(10))
               )

      assert view_for(views) == MapSet.new([2])
    end

    test "applies a queued move out for the active move-in value after splice" do
      handler = new_handler()
      dep_handle = dep_handle(handler)

      assert {:ok, %Buffering{active_move: %ActiveMove{}} = handler, _plan} =
               EventHandler.handle_event(
                 handler,
                 {:materializer_changes, dep_handle, %{move_in: [{1, "1"}], move_out: []}}
               )

      assert {:ok, %Buffering{active_move: %ActiveMove{}} = handler, []} =
               EventHandler.handle_event(
                 handler,
                 {:materializer_changes, dep_handle, %{move_in: [], move_out: [{1, "1"}]}}
               )

      assert {:ok, %Buffering{active_move: %ActiveMove{}} = handler, _plan} =
               EventHandler.handle_event(handler, {:pg_snapshot_known, {100, 200, []}})

      assert {:ok, %Buffering{active_move: %ActiveMove{}} = handler, _plan} =
               EventHandler.handle_event(
                 handler,
                 move_in_complete(lsn(10))
               )

      assert {:ok, %Steady{views: views}, plan} =
               EventHandler.handle_event(handler, global_last_seen_lsn(10))

      assert view_for(views) == MapSet.new()

      assert [
               %Effects.AppendControl{message: %{headers: %{event: "move-in"}}},
               %Effects.AppendMoveInSnapshot{
                 snapshot_name: "move-in-snapshot",
                 row_count: 1,
                 row_bytes: 100
               },
               %Effects.AppendControl{
                 message: %{headers: %{event: "move-out", patterns: [%{pos: 0}]}}
               },
               %Effects.RemoveFromSubqueryIndex{dep_index: 0, values: [{1, "1"}]},
               %Effects.UnsubscribeGlobalLsn{}
             ] = plan
    end

    test "batches consecutive move ins into a single active move in" do
      handler = new_handler()
      dep_handle = dep_handle(handler)

      assert {:ok, %Buffering{active_move: %ActiveMove{}} = handler, _plan} =
               EventHandler.handle_event(
                 handler,
                 {:materializer_changes, dep_handle,
                  %{move_in: [{1, "1"}, {2, "2"}], move_out: []}}
               )

      assert %Buffering{
               active_move: %ActiveMove{
                 values: [{1, "1"}, {2, "2"}],
                 views_before_move: views_before,
                 views_after_move: views_after
               }
             } = handler

      assert view_for(views_before) == MapSet.new()
      assert view_for(views_after) == MapSet.new([1, 2])
    end

    test "cancels pending inverse ops while buffering" do
      handler = new_handler()
      dep_handle = dep_handle(handler)

      assert {:ok, %Buffering{active_move: %ActiveMove{}} = handler, _plan} =
               EventHandler.handle_event(
                 handler,
                 {:materializer_changes, dep_handle, %{move_in: [{1, "1"}], move_out: []}}
               )

      assert {:ok, %Buffering{active_move: %ActiveMove{}} = handler, []} =
               EventHandler.handle_event(
                 handler,
                 {:materializer_changes, dep_handle, %{move_in: [{2, "2"}], move_out: []}}
               )

      assert {:ok, %Buffering{active_move: %ActiveMove{}} = handler, []} =
               EventHandler.handle_event(
                 handler,
                 {:materializer_changes, dep_handle, %{move_in: [], move_out: [{2, "2"}]}}
               )

      assert {:ok, %Buffering{active_move: %ActiveMove{}} = handler, _plan} =
               EventHandler.handle_event(handler, {:pg_snapshot_known, {100, 200, []}})

      assert {:ok, %Buffering{active_move: %ActiveMove{}} = handler, _plan} =
               EventHandler.handle_event(
                 handler,
                 move_in_complete(lsn(10))
               )

      assert {:ok, %Steady{views: views}, plan} =
               EventHandler.handle_event(handler, global_last_seen_lsn(10))

      assert view_for(views) == MapSet.new([1])

      assert [
               %Effects.AppendControl{message: %{headers: %{event: "move-in"}}},
               %Effects.AppendMoveInSnapshot{
                 snapshot_name: "move-in-snapshot",
                 row_count: 1,
                 row_bytes: 100
               },
               %Effects.UnsubscribeGlobalLsn{}
             ] = plan
    end

    test "merges queued move outs into a single control message after splice" do
      handler = new_handler(subquery_view: MapSet.new([2]))
      dep_handle = dep_handle(handler)

      assert {:ok, %Buffering{active_move: %ActiveMove{}} = handler, _plan} =
               EventHandler.handle_event(
                 handler,
                 {:materializer_changes, dep_handle, %{move_in: [{1, "1"}], move_out: []}}
               )

      assert {:ok, %Buffering{active_move: %ActiveMove{}} = handler, []} =
               EventHandler.handle_event(
                 handler,
                 {:materializer_changes, dep_handle, %{move_in: [], move_out: [{1, "1"}]}}
               )

      assert {:ok, %Buffering{active_move: %ActiveMove{}} = handler, []} =
               EventHandler.handle_event(
                 handler,
                 {:materializer_changes, dep_handle, %{move_in: [], move_out: [{2, "2"}]}}
               )

      assert {:ok, %Buffering{active_move: %ActiveMove{}} = handler, _plan} =
               EventHandler.handle_event(handler, {:pg_snapshot_known, {100, 200, []}})

      assert {:ok, %Buffering{active_move: %ActiveMove{}} = handler, _plan} =
               EventHandler.handle_event(
                 handler,
                 move_in_complete(lsn(10))
               )

      assert {:ok, %Steady{views: views}, plan} =
               EventHandler.handle_event(handler, global_last_seen_lsn(10))

      assert view_for(views) == MapSet.new()

      assert [
               %Effects.AppendControl{message: %{headers: %{event: "move-in"}}},
               %Effects.AppendMoveInSnapshot{
                 snapshot_name: "move-in-snapshot",
                 row_count: 1,
                 row_bytes: 100
               },
               %Effects.AppendControl{
                 message: %{headers: %{event: "move-out", patterns: patterns}}
               },
               %Effects.RemoveFromSubqueryIndex{values: values},
               %Effects.UnsubscribeGlobalLsn{}
             ] = plan

      assert length(patterns) == 2
      assert length(values) == 2
    end

    test "returns {:error, :buffer_overflow} when buffered transactions exceed the limit" do
      handler = new_handler(buffer_max_transactions: 3)
      dep_handle = dep_handle(handler)

      assert {:ok, %Buffering{active_move: %ActiveMove{}} = handler, _plan} =
               EventHandler.handle_event(
                 handler,
                 {:materializer_changes, dep_handle, %{move_in: [{1, "1"}], move_out: []}}
               )

      assert {:ok, %Buffering{active_move: %ActiveMove{}} = handler, _plan} =
               EventHandler.handle_event(handler, txn(50, [child_insert("1", "1")]))

      assert {:ok, %Buffering{active_move: %ActiveMove{}} = handler, _plan} =
               EventHandler.handle_event(handler, txn(51, [child_insert("2", "1")]))

      assert {:ok, %Buffering{active_move: %ActiveMove{}} = handler, _plan} =
               EventHandler.handle_event(handler, txn(52, [child_insert("3", "1")]))

      assert {:error, :buffer_overflow} =
               EventHandler.handle_event(handler, txn(53, [child_insert("4", "1")]))
    end

    test "returns truncate error on TruncatedRelation while steady" do
      handler = new_handler(subquery_view: MapSet.new([1]))

      assert {:error, {:truncate, 1}} =
               EventHandler.handle_event(handler, txn(1, [child_truncate()]))
    end

    test "returns truncate error while buffering once splice completes" do
      handler = new_handler()
      dep_handle = dep_handle(handler)

      assert {:ok, %Buffering{active_move: %ActiveMove{}} = handler, _plan} =
               EventHandler.handle_event(
                 handler,
                 {:materializer_changes, dep_handle, %{move_in: [{1, "1"}], move_out: []}}
               )

      assert {:ok, %Buffering{active_move: %ActiveMove{}} = handler, _plan} =
               EventHandler.handle_event(handler, txn(50, [child_truncate()]))

      assert {:ok, %Buffering{active_move: %ActiveMove{}} = handler, _plan} =
               EventHandler.handle_event(handler, {:pg_snapshot_known, {100, 150, []}})

      assert {:ok, %Buffering{active_move: %ActiveMove{}} = handler, _plan} =
               EventHandler.handle_event(
                 handler,
                 move_in_complete(lsn(10))
               )

      assert {:error, {:truncate, 50}} =
               EventHandler.handle_event(handler, global_last_seen_lsn(10))
    end

    test "raises on dependency handle mismatch" do
      assert_raise ArgumentError, ~r/unexpected dependency handle/, fn ->
        new_handler()
        |> EventHandler.handle_event(
          {:materializer_changes, "wrong", %{move_in: [], move_out: []}}
        )
      end
    end

    test "raises on query callbacks while steady" do
      handler = new_handler()

      assert_raise ArgumentError, ~r/no move-in is buffering/, fn ->
        EventHandler.handle_event(handler, {:pg_snapshot_known, {100, 200, []}})
      end

      assert_raise ArgumentError, ~r/no move-in is buffering/, fn ->
        EventHandler.handle_event(handler, move_in_complete(lsn(1), row_count: 0, row_bytes: 0))
      end
    end
  end

  # -- Helpers --

  defp new_handler(opts \\ []) do
    shape = Keyword.get(opts, :shape, shape())
    {:ok, dnf_plan} = DnfPlan.compile(shape)
    dep_handle = hd(shape.shape_dependencies_handles)

    %Steady{
      shape_info: %ShapeInfo{
        shape: shape,
        stack_id: "stack-id",
        shape_handle: "shape-handle",
        dnf_plan: dnf_plan,
        ref_resolver:
          RefResolver.new(%{dep_handle => {0, ["$sublink", "0"]}}, %{0 => ["$sublink", "0"]}),
        buffer_max_transactions: Keyword.get(opts, :buffer_max_transactions, 1000),
        dependency_move_policy:
          Keyword.get(opts, :dependency_move_policy, :stream_dependency_moves)
      },
      views: %{["$sublink", "0"] => Keyword.get(opts, :subquery_view, MapSet.new())}
    }
  end

  defp dep_handle(handler) do
    handler.shape_info.ref_resolver.handle_to_ref |> Map.keys() |> hd()
  end

  defp view_for(views, ref \\ ["$sublink", "0"]) when is_map(views) do
    views[ref]
  end

  defp shape do
    Shape.new!("child",
      where: "parent_id IN (SELECT id FROM public.parent WHERE value = 'keep')",
      inspector: @inspector,
      feature_flags: ["allow_subqueries"]
    )
    |> fill_handles()
  end

  defp negated_shape do
    Shape.new!("child",
      where: "parent_id NOT IN (SELECT id FROM public.parent WHERE value = 'keep')",
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
    %Transaction{
      xid: xid,
      changes: changes,
      num_changes: length(changes),
      lsn: lsn(xid),
      last_log_offset: Electric.Replication.LogOffset.new(lsn(xid), max(length(changes) - 1, 0))
    }
  end

  defp lsn(value), do: Lsn.from_integer(value)
  defp global_last_seen_lsn(value), do: {:global_last_seen_lsn, value}

  defp move_in_complete(lsn, opts \\ []) do
    {:query_move_in_complete, Keyword.get(opts, :snapshot_name, "move-in-snapshot"),
     Keyword.get(opts, :row_count, 1), Keyword.get(opts, :row_bytes, 100), lsn}
  end

  defp child_insert(id, parent_id) do
    %Changes.NewRecord{
      relation: {"public", "child"},
      record: %{"id" => id, "parent_id" => parent_id, "name" => "child-#{id}"}
    }
    |> Changes.fill_key(["id"])
  end

  defp child_truncate do
    %Changes.TruncatedRelation{relation: {"public", "child"}}
  end

  defp child_update(id, old_parent_id, new_parent_id) do
    Changes.UpdatedRecord.new(
      relation: {"public", "child"},
      old_record: %{"id" => id, "parent_id" => old_parent_id, "name" => "child-#{id}-old"},
      record: %{"id" => id, "parent_id" => new_parent_id, "name" => "child-#{id}-new"}
    )
    |> Changes.fill_key(["id"])
  end
end
