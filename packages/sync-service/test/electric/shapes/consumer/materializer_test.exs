defmodule Electric.Shapes.Consumer.MaterializerTest do
  use ExUnit.Case, async: true
  import ExUnit.CaptureLog
  import Support.ComponentSetup
  use Repatch.ExUnit

  alias Electric.Shapes.Shape
  alias Electric.LogItems
  alias Electric.Replication.Changes
  alias Electric.ShapeCache.Storage
  alias Electric.Shapes.ConsumerRegistry
  alias Electric.Replication.LogOffset
  alias Electric.Shapes.Consumer.Materializer

  @moduletag :tmp_dir

  setup [
    :with_stack_id_from_test,
    :with_async_deleter,
    :with_pure_file_storage,
    :with_consumer_registry
  ]

  @shape %Shape{
    root_table: {"public", "items"},
    root_table_id: 1,
    root_pk: ["id"],
    storage: %{compaction: :disabled}
  }

  setup %{storage: storage, stack_id: stack_id} = ctx do
    ConsumerRegistry.register_consumer(self(), "test", stack_id)

    Storage.for_shape("test", storage) |> Storage.start_link()
    writer = Storage.for_shape("test", storage) |> Storage.init_writer!(@shape)
    Storage.for_shape("test", storage) |> Storage.mark_snapshot_as_started()
    Storage.hibernate(writer)

    snapshot_data =
      Map.get(ctx, :snapshot_data, [])
      |> case do
        [] -> []
        [x | _] = items when is_map(x) -> make_snapshot_data(items)
        [x | _] = items when is_binary(x) -> items
        {items, opts} -> make_snapshot_data(items, opts)
      end

    Storage.for_shape("test", storage)
    |> then(&Storage.make_new_snapshot!(snapshot_data, &1))

    {:ok, shape_handle: "test", shape_storage: Storage.for_shape("test", storage), writer: writer}
  end

  test "can get ready",
       %{storage: storage, stack_id: stack_id, shape_handle: shape_handle} = ctx do
    {:ok, _pid} =
      Materializer.start_link(%{
        stack_id: stack_id,
        shape_handle: shape_handle,
        storage: storage,
        columns: ["value"],
        materialized_type: {:array, :int8}
      })

    respond_to_call(:await_snapshot_start, :started)

    respond_to_call(
      :subscribe_materializer,
      {:ok, LogOffset.last_before_real_offsets()}
    )

    assert Materializer.wait_until_ready(ctx) == :ok
  end

  test "new changes are materialized correctly",
       %{storage: storage, stack_id: stack_id, shape_handle: shape_handle} = ctx do
    {:ok, _pid} =
      Materializer.start_link(%{
        stack_id: stack_id,
        shape_handle: shape_handle,
        storage: storage,
        columns: ["value"],
        materialized_type: {:array, :int8}
      })

    respond_to_call(:await_snapshot_start, :started)

    respond_to_call(
      :subscribe_materializer,
      {:ok, LogOffset.last_before_real_offsets()}
    )

    assert Materializer.wait_until_ready(ctx) == :ok

    Materializer.new_changes(ctx, [
      %Changes.NewRecord{key: "1", record: %{"value" => "1"}},
      %Changes.NewRecord{key: "2", record: %{"value" => "2"}},
      %Changes.NewRecord{key: "3", record: %{"value" => "3"}}
    ])

    assert Materializer.get_link_values(ctx) == MapSet.new([1, 2, 3])
  end

  describe "materializing non-pk selected columns" do
    test "runtime insert of a new value is seen & causes a move-in", ctx do
      ctx = with_materializer(ctx)

      Materializer.new_changes(ctx, [
        %Changes.NewRecord{key: "1", record: %{"value" => "1"}}
      ])

      assert Materializer.get_link_values(ctx) == MapSet.new([1])

      assert_receive {:materializer_changes, _, %{move_in: [{1, "1"}]}}
    end

    @tag snapshot_data: [%Changes.NewRecord{record: %{"id" => "1", "value" => "10"}}]
    test "on-load insert of a new value is seen & does not cause a move-in", ctx do
      ctx = with_materializer(ctx)

      assert Materializer.get_link_values(ctx) == MapSet.new([10])

      refute_received {:materializer_changes, _, _}
    end

    @tag snapshot_data: [%Changes.NewRecord{record: %{"id" => "1", "value" => "10"}}]
    test "runtime update of a value is seen & causes a move-out & move-in", ctx do
      ctx = with_materializer(ctx)

      Materializer.new_changes(
        ctx,
        [
          %Changes.UpdatedRecord{
            record: %{"id" => "1", "value" => "11"},
            old_record: %{"id" => "1", "value" => "10"}
          }
        ]
        |> prep_changes()
      )

      assert Materializer.get_link_values(ctx) == MapSet.new([11])

      assert_receive {:materializer_changes, _, %{move_out: [{10, "10"}], move_in: [{11, "11"}]}}
    end

    @tag snapshot_data: [
           %Changes.NewRecord{record: %{"id" => "1", "value" => "10"}},
           Changes.UpdatedRecord.new(
             record: %{"id" => "1", "value" => "11"},
             old_record: %{"id" => "1", "value" => "10"}
           )
         ]
    test "on-load update of a value is seen & does not cause events", ctx do
      ctx = with_materializer(ctx)
      assert Materializer.get_link_values(ctx) == MapSet.new([11])
      refute_received {:materializer_changes, _, _}
    end

    @tag snapshot_data: [%Changes.NewRecord{record: %{"id" => "1", "value" => "10"}}]
    test "runtime delete of a value is seen & causes a move-out", ctx do
      ctx = with_materializer(ctx)

      Materializer.new_changes(
        ctx,
        [%Changes.DeletedRecord{old_record: %{"id" => "1", "value" => "10"}}] |> prep_changes()
      )

      assert Materializer.get_link_values(ctx) == MapSet.new([])

      assert_receive {:materializer_changes, _, %{move_out: [{10, "10"}]}}
    end

    @tag snapshot_data: [
           %Changes.NewRecord{record: %{"id" => "1", "value" => "10"}},
           %Changes.DeletedRecord{old_record: %{"id" => "1", "value" => "10"}}
         ]
    test "on-load delete of a value is seen & does not cause events", ctx do
      ctx = with_materializer(ctx)

      assert Materializer.get_link_values(ctx) == MapSet.new([])

      refute_received {:materializer_changes, _, _}
    end

    @tag snapshot_data: [%Changes.NewRecord{record: %{"id" => "1", "value" => "10"}}]
    test "insert of a value that's already present in the shape does not cause events", ctx do
      ctx = with_materializer(ctx)

      Materializer.new_changes(
        ctx,
        [%Changes.NewRecord{record: %{"id" => "2", "value" => "10"}}] |> prep_changes()
      )

      assert Materializer.get_link_values(ctx) == MapSet.new([10])

      refute_received {:materializer_changes, _, _}
    end

    @tag snapshot_data: [
           %Changes.NewRecord{record: %{"id" => "1", "value" => "10"}},
           %Changes.NewRecord{record: %{"id" => "2", "value" => "20"}}
         ]
    test "update of a value to a present value causes just a move-out", ctx do
      ctx = with_materializer(ctx)

      assert Materializer.get_link_values(ctx) == MapSet.new([10, 20])

      Materializer.new_changes(
        ctx,
        [
          %Changes.UpdatedRecord{
            record: %{"id" => "1", "value" => "20"},
            old_record: %{"id" => "1", "value" => "10"}
          }
        ]
        |> prep_changes()
      )

      assert Materializer.get_link_values(ctx) == MapSet.new([20])

      assert_received {:materializer_changes, _, %{move_out: [{10, "10"}]}}
    end

    @tag snapshot_data: [
           %Changes.NewRecord{record: %{"id" => "1", "value" => "10"}},
           %Changes.NewRecord{record: %{"id" => "2", "value" => "10"}}
         ]
    test "update of a value to a non-present value causes a move-in", ctx do
      ctx = with_materializer(ctx)

      assert Materializer.get_link_values(ctx) == MapSet.new([10])

      Materializer.new_changes(
        ctx,
        [
          %Changes.UpdatedRecord{
            record: %{"id" => "1", "value" => "20"},
            old_record: %{"id" => "1", "value" => "10"}
          }
        ]
        |> prep_changes()
      )

      assert Materializer.get_link_values(ctx) == MapSet.new([10, 20])

      assert_received {:materializer_changes, _, %{move_in: [{20, "20"}]}}
    end

    @tag snapshot_data: [
           %Changes.NewRecord{record: %{"id" => "1", "value" => "10"}},
           %Changes.NewRecord{record: %{"id" => "2", "value" => "20"}},
           %Changes.NewRecord{record: %{"id" => "3", "value" => "10"}}
         ]
    test "update between otherwise present values causes no events", ctx do
      ctx = with_materializer(ctx)

      assert Materializer.get_link_values(ctx) == MapSet.new([10, 20])

      Materializer.new_changes(
        ctx,
        [
          %Changes.UpdatedRecord{
            record: %{"id" => "1", "value" => "20"},
            old_record: %{"id" => "1", "value" => "10"}
          }
        ]
        |> prep_changes()
      )

      assert Materializer.get_link_values(ctx) == MapSet.new([10, 20])

      refute_received {:materializer_changes, _, _}
    end

    @tag snapshot_data: [
           %Changes.NewRecord{record: %{"id" => "1", "value" => "10"}},
           %Changes.NewRecord{record: %{"id" => "2", "value" => "10"}}
         ]
    test "delete of an otherwise present value causes no events", ctx do
      ctx = with_materializer(ctx)

      Materializer.new_changes(
        ctx,
        [%Changes.DeletedRecord{old_record: %{"id" => "1", "value" => "10"}}] |> prep_changes()
      )

      assert Materializer.get_link_values(ctx) == MapSet.new([10])

      refute_received {:materializer_changes, _, _}
    end

    @tag snapshot_data: [
           %Changes.NewRecord{record: %{"id" => "1", "value" => "10"}},
           %Changes.NewRecord{record: %{"id" => "2", "value" => "10"}}
         ]
    test "insert of an otherwise present value causes no events", ctx do
      ctx = with_materializer(ctx)

      Materializer.new_changes(
        ctx,
        [%Changes.NewRecord{record: %{"id" => "3", "value" => "10"}}] |> prep_changes()
      )

      assert Materializer.get_link_values(ctx) == MapSet.new([10])

      refute_received {:materializer_changes, _, _}
    end

    @tag snapshot_data: [
           %Changes.NewRecord{record: %{"id" => "1", "value" => "10"}}
         ]
    test "insert of a PK we've already seen raises", ctx do
      ctx = with_materializer(ctx)

      assert Materializer.get_link_values(ctx) == MapSet.new([10])

      pid = GenServer.whereis(Materializer.name(ctx))
      Process.unlink(pid)

      try do
        Materializer.new_changes(
          ctx,
          [%Changes.NewRecord{record: %{"id" => "1", "value" => "10"}}] |> prep_changes()
        )
      catch
        :exit, {{reason, _}, _} ->
          assert reason.message =~ ~r/Key .* already exists/
      end
    end

    test "delete of a PK we've not seen throws an error", ctx do
      ctx = with_materializer(ctx)

      assert Materializer.get_link_values(ctx) == MapSet.new([])

      pid = GenServer.whereis(Materializer.name(ctx))
      Process.unlink(pid)

      capture_log(fn ->
        try do
          Materializer.new_changes(
            ctx,
            [%Changes.DeletedRecord{old_record: %{"id" => "1", "value" => "10"}}]
            |> prep_changes()
          )
        catch
          :exit, {{reason, _}, _} ->
            assert %KeyError{key: _} = reason
        end
      end)
    end

    test "events are accumulated across uncommitted fragments", ctx do
      ctx = with_materializer(ctx)

      Materializer.new_changes(
        ctx,
        [
          %Changes.NewRecord{key: "1", record: %{"value" => "1"}},
          %Changes.NewRecord{key: "2", record: %{"value" => "2"}},
          %Changes.NewRecord{key: "3", record: %{"value" => "3"}}
        ],
        commit: false
      )

      refute_received {:materializer_changes, _, _}

      Materializer.new_changes(ctx, [
        %Changes.NewRecord{key: "4", record: %{"value" => "4"}},
        %Changes.NewRecord{key: "5", record: %{"value" => "5"}}
      ])

      assert_receive {:materializer_changes, _, %{move_in: move_ins, move_out: []}}
      assert [{1, "1"}, {2, "2"}, {3, "3"}, {4, "4"}, {5, "5"}] == Enum.sort(move_ins)
    end

    test "moves are correctly tracked across multiple calls", ctx do
      ctx = with_materializer(ctx)

      Materializer.new_changes(ctx, [
        %Changes.NewRecord{key: "1", record: %{"value" => "1"}},
        %Changes.NewRecord{key: "2", record: %{"value" => "2"}},
        %Changes.NewRecord{key: "3", record: %{"value" => "1"}}
      ])

      assert Materializer.get_link_values(ctx) == MapSet.new([1, 2])

      assert_receive {:materializer_changes, _, %{move_in: move_in}}
      assert Enum.sort(move_in) == [{1, "1"}, {2, "2"}]

      Materializer.new_changes(ctx, [
        %Changes.UpdatedRecord{
          key: "2",
          record: %{"value" => "3"},
          old_record: %{"value" => "2"}
        },
        %Changes.DeletedRecord{key: "3", old_record: %{"value" => "1"}},
        %Changes.UpdatedRecord{key: "1", record: %{"other" => "1"}, old_record: %{"other" => "0"}}
      ])

      assert Materializer.get_link_values(ctx) == MapSet.new([1, 3])

      assert_receive {:materializer_changes, _, %{move_out: [{2, "2"}], move_in: [{3, "3"}]}}
    end
  end

  describe "same-batch move event cancellation" do
    test "insert and delete in same batch emits no events", ctx do
      ctx = with_materializer(ctx)

      apply_changes(ctx, [
        insert("1", "10"),
        delete("1", "10")
      ])

      refute_received {:materializer_changes, _, _}
    end

    @tag snapshot_data: [%Changes.NewRecord{record: %{"id" => "1", "value" => "10"}}]
    test "existing value removed and re-added emits no events", ctx do
      ctx = with_materializer(ctx)

      apply_changes(ctx, [
        update("1", "10", "20"),
        update("1", "20", "10")
      ])

      refute_received {:materializer_changes, _, _}
    end

    test "two move_ins and one move_out emits net one move_in", ctx do
      ctx = with_materializer(ctx)

      apply_changes(ctx, [
        insert("1", "10"),
        delete("1", "10"),
        insert("2", "10")
      ])

      assert_moved_in(["10"])
    end

    test "cancellation does not affect unrelated values", ctx do
      ctx = with_materializer(ctx)

      apply_changes(ctx, [
        insert("1", "10"),
        delete("1", "10"),
        insert("2", "20")
      ])

      assert_moved_in(["20"])
    end

    @tag snapshot_data: [%Changes.NewRecord{record: %{"id" => "1", "value" => "10"}}]
    test "net move_out survives when more outs than ins", ctx do
      ctx = with_materializer(ctx)

      apply_changes(ctx, [
        delete("1", "10"),
        insert("2", "10"),
        delete("2", "10")
      ])

      assert_moved_out(["10"])
    end

    test "net move_in survives when more ins than outs", ctx do
      ctx = with_materializer(ctx)

      apply_changes(ctx, [
        insert("1", "10"),
        update("1", "10", "20"),
        update("1", "20", "10")
      ])

      assert_moved_in(["10"])
    end

    defp insert(id, value),
      do: %Changes.NewRecord{record: %{"id" => id, "value" => value}}

    defp update(id, old_value, new_value),
      do: %Changes.UpdatedRecord{
        record: %{"id" => id, "value" => new_value},
        old_record: %{"id" => id, "value" => old_value}
      }

    defp delete(id, value),
      do: %Changes.DeletedRecord{old_record: %{"id" => id, "value" => value}}

    defp apply_changes(ctx, changes),
      do: Materializer.new_changes(ctx, prep_changes(changes))

    defp assert_moved_in(values) do
      assert_receive {:materializer_changes, _, events}
      assert Enum.sort(events.move_in) == Enum.map(values, &{String.to_integer(&1), &1})
    end

    defp assert_moved_out(values) do
      assert_receive {:materializer_changes, _, events}
      assert Enum.sort(events.move_out) == Enum.map(values, &{String.to_integer(&1), &1})
    end
  end

  describe "tag-only updates (value unchanged)" do
    @tag snapshot_data: [%Changes.NewRecord{record: %{"id" => "1", "value" => "10"}}]
    test "update with tag change but unchanged value updates tags without events", ctx do
      ctx = with_materializer(ctx)

      assert Materializer.get_link_values(ctx) == MapSet.new([10])

      # Update where tags change but the tracked value stays the same
      Materializer.new_changes(
        ctx,
        [
          %Changes.UpdatedRecord{
            key: ~s("public"."test_table"/"1"),
            record: %{"id" => "1", "value" => "10"},
            old_record: %{"id" => "1", "value" => "10"},
            move_tags: ["new_tag"],
            removed_move_tags: ["old_tag"]
          }
        ]
      )

      # Value should still be present
      assert Materializer.get_link_values(ctx) == MapSet.new([10])

      # No move events should be emitted since the value didn't change
      refute_received {:materializer_changes, _, _}
    end

    @tag snapshot_data: {
           [%Changes.NewRecord{record: %{"id" => "1", "value" => "10"}, move_tags: ["old_tag"]}],
           []
         }
    test "tag is updated so subsequent move_out for old tag finds nothing", ctx do
      ctx = with_materializer(ctx)

      assert Materializer.get_link_values(ctx) == MapSet.new([10])

      # Update that changes the tag from old_tag to new_tag but keeps value the same
      Materializer.new_changes(
        ctx,
        [
          %Changes.UpdatedRecord{
            key: ~s("public"."test_table"/"1"),
            record: %{"id" => "1", "value" => "10"},
            old_record: %{"id" => "1", "value" => "10"},
            move_tags: ["new_tag"],
            removed_move_tags: ["old_tag"]
          }
        ]
      )

      # No events from the tag-only update
      refute_received {:materializer_changes, _, _}

      # Now send a move_out for the OLD tag - should find nothing since the row moved to new_tag
      Materializer.new_changes(ctx, [
        %{headers: %{event: "move-out", patterns: [%{pos: 0, value: "old_tag"}]}}
      ])

      # Value should still be present (row wasn't removed)
      assert Materializer.get_link_values(ctx) == MapSet.new([10])

      # No move events since the row was already moved to new_tag
      refute_received {:materializer_changes, _, _}
    end

    @tag snapshot_data: {
           [%Changes.NewRecord{record: %{"id" => "1", "value" => "10"}, move_tags: ["old_tag"]}],
           []
         }
    test "move_out for new tag after tag update removes the row", ctx do
      ctx = with_materializer(ctx)

      assert Materializer.get_link_values(ctx) == MapSet.new([10])

      # Update that changes the tag from old_tag to new_tag
      Materializer.new_changes(
        ctx,
        [
          %Changes.UpdatedRecord{
            key: ~s("public"."test_table"/"1"),
            record: %{"id" => "1", "value" => "10"},
            old_record: %{"id" => "1", "value" => "10"},
            move_tags: ["new_tag"],
            removed_move_tags: ["old_tag"]
          }
        ]
      )

      refute_received {:materializer_changes, _, _}

      # Now send a move_out for the NEW tag - should find and remove the row
      Materializer.new_changes(ctx, [
        %{headers: %{event: "move-out", patterns: [%{pos: 0, value: "new_tag"}]}}
      ])

      # Value should be gone
      assert Materializer.get_link_values(ctx) == MapSet.new([])

      # Should emit move_out event
      assert_receive {:materializer_changes, _, %{move_out: [{10, "10"}]}}
    end

    @tag snapshot_data: {
           [
             %Changes.NewRecord{record: %{"id" => "1", "value" => "10"}, move_tags: ["tag_a"]},
             %Changes.NewRecord{record: %{"id" => "2", "value" => "20"}, move_tags: ["tag_a"]}
           ],
           []
         }
    test "multiple rows with same tag, one updates tag, move_out only affects remaining", ctx do
      ctx = with_materializer(ctx)

      assert Materializer.get_link_values(ctx) == MapSet.new([10, 20])

      # Row 1 moves from tag_a to tag_b, row 2 stays in tag_a
      Materializer.new_changes(
        ctx,
        [
          %Changes.UpdatedRecord{
            key: ~s("public"."test_table"/"1"),
            record: %{"id" => "1", "value" => "10"},
            old_record: %{"id" => "1", "value" => "10"},
            move_tags: ["tag_b"],
            removed_move_tags: ["tag_a"]
          }
        ]
      )

      refute_received {:materializer_changes, _, _}

      # move_out for tag_a should only affect row 2 (row 1 moved to tag_b)
      Materializer.new_changes(ctx, [
        %{headers: %{event: "move-out", patterns: [%{pos: 0, value: "tag_a"}]}}
      ])

      # Only value 10 should remain (row 1 is now under tag_b)
      assert Materializer.get_link_values(ctx) == MapSet.new([10])

      # Should emit move_out only for row 2's value
      assert_receive {:materializer_changes, _, %{move_out: [{20, "20"}]}}
    end
  end

  describe "move_out events" do
    test "runtime move_out event removes rows matching the pattern", ctx do
      ctx = with_materializer(ctx)

      # Insert records with move_tags
      Materializer.new_changes(ctx, [
        %Changes.NewRecord{key: "1", record: %{"value" => "10"}, move_tags: ["tag1"]},
        %Changes.NewRecord{key: "2", record: %{"value" => "20"}, move_tags: ["tag2"]},
        %Changes.NewRecord{key: "3", record: %{"value" => "30"}, move_tags: ["tag1"]}
      ])

      assert Materializer.get_link_values(ctx) == MapSet.new([10, 20, 30])
      assert_receive {:materializer_changes, _, %{move_in: _}}

      # Send move_out event to remove rows with tag1
      Materializer.new_changes(ctx, [
        %{headers: %{event: "move-out", patterns: [%{pos: 0, value: "tag1"}]}}
      ])

      assert Materializer.get_link_values(ctx) == MapSet.new([20])
      assert_receive {:materializer_changes, _, %{move_out: move_out}}
      assert Enum.sort(move_out) == [{10, "10"}, {30, "30"}]
    end

    test "runtime move_out event with multiple patterns removes all matching rows", ctx do
      ctx = with_materializer(ctx)

      Materializer.new_changes(ctx, [
        %Changes.NewRecord{key: "1", record: %{"value" => "10"}, move_tags: ["tag1"]},
        %Changes.NewRecord{key: "2", record: %{"value" => "20"}, move_tags: ["tag2"]},
        %Changes.NewRecord{key: "3", record: %{"value" => "30"}, move_tags: ["tag3"]}
      ])

      assert Materializer.get_link_values(ctx) == MapSet.new([10, 20, 30])
      assert_receive {:materializer_changes, _, %{move_in: _}}

      # Remove rows with tag1 or tag3
      Materializer.new_changes(ctx, [
        %{
          headers: %{
            event: "move-out",
            patterns: [%{pos: 0, value: "tag1"}, %{pos: 0, value: "tag3"}]
          }
        }
      ])

      assert Materializer.get_link_values(ctx) == MapSet.new([20])
      assert_receive {:materializer_changes, _, %{move_out: move_out}}
      assert Enum.sort(move_out) == [{10, "10"}, {30, "30"}]
    end

    test "runtime move_out event for non-existent pattern causes no events", ctx do
      ctx = with_materializer(ctx)

      Materializer.new_changes(ctx, [
        %Changes.NewRecord{key: "1", record: %{"value" => "10"}, move_tags: ["tag1"]}
      ])

      assert Materializer.get_link_values(ctx) == MapSet.new([10])
      assert_receive {:materializer_changes, _, %{move_in: [{10, "10"}]}}

      # Try to remove rows with non-existent tag
      Materializer.new_changes(ctx, [
        %{headers: %{event: "move-out", patterns: [%{pos: 0, value: "non_existent"}]}}
      ])

      assert Materializer.get_link_values(ctx) == MapSet.new([10])
      refute_received {:materializer_changes, _, _}
    end

    test "runtime move_out event removes row but value remains if another row has same value",
         ctx do
      ctx = with_materializer(ctx)

      Materializer.new_changes(ctx, [
        %Changes.NewRecord{key: "1", record: %{"value" => "10"}, move_tags: ["tag1"]},
        %Changes.NewRecord{key: "2", record: %{"value" => "10"}, move_tags: ["tag2"]}
      ])

      assert Materializer.get_link_values(ctx) == MapSet.new([10])
      assert_receive {:materializer_changes, _, %{move_in: [{10, "10"}]}}

      # Remove only tag1 row
      Materializer.new_changes(ctx, [
        %{headers: %{event: "move-out", patterns: [%{pos: 0, value: "tag1"}]}}
      ])

      # Value 10 should still be present because key "2" still has it
      assert Materializer.get_link_values(ctx) == MapSet.new([10])
      refute_received {:materializer_changes, _, _}
    end

    @tag snapshot_data: {
           [
             %Changes.NewRecord{record: %{"id" => "1", "value" => "10"}, move_tags: ["tag1"]},
             %Changes.NewRecord{record: %{"id" => "2", "value" => "20"}, move_tags: ["tag2"]}
           ],
           []
         }
    test "on-load tags are tracked and can be removed by runtime move_out", ctx do
      ctx = with_materializer(ctx)

      # Both values should be present after on-load
      assert Materializer.get_link_values(ctx) == MapSet.new([10, 20])

      # Now send move_out event to remove rows with tag1
      Materializer.new_changes(ctx, [
        %{headers: %{event: "move-out", patterns: [%{pos: 0, value: "tag1"}]}}
      ])

      # Only value 20 should remain after move_out
      assert Materializer.get_link_values(ctx) == MapSet.new([20])
      assert_receive {:materializer_changes, _, %{move_out: [{10, "10"}]}}
    end

    @tag snapshot_data: {
           [
             %Changes.NewRecord{record: %{"id" => "1", "value" => "10"}, move_tags: ["tag1"]},
             %Changes.NewRecord{record: %{"id" => "2", "value" => "10"}, move_tags: ["tag2"]}
           ],
           []
         }
    test "on-load tags tracked correctly when values are duplicated", ctx do
      ctx = with_materializer(ctx)

      # Value 10 should be present (from both rows)
      assert Materializer.get_link_values(ctx) == MapSet.new([10])

      # Remove rows with tag1
      Materializer.new_changes(ctx, [
        %{headers: %{event: "move-out", patterns: [%{pos: 0, value: "tag1"}]}}
      ])

      # Value 10 should still be present because key "2" still has it
      assert Materializer.get_link_values(ctx) == MapSet.new([10])
      refute_received {:materializer_changes, _, _}
    end

    @tag snapshot_data: {
           [
             %Changes.NewRecord{record: %{"id" => "1", "value" => "10"}, move_tags: ["tag1"]},
             %Changes.NewRecord{record: %{"id" => "2", "value" => "20"}, move_tags: ["tag1"]},
             %Changes.NewRecord{record: %{"id" => "3", "value" => "30"}, move_tags: ["tag2"]}
           ],
           []
         }
    test "on-load tags with multiple rows sharing same tag can all be removed", ctx do
      ctx = with_materializer(ctx)

      assert Materializer.get_link_values(ctx) == MapSet.new([10, 20, 30])

      # Remove all rows with tag1
      Materializer.new_changes(ctx, [
        %{headers: %{event: "move-out", patterns: [%{pos: 0, value: "tag1"}]}}
      ])

      assert Materializer.get_link_values(ctx) == MapSet.new([30])
      assert_receive {:materializer_changes, _, %{move_out: move_out}}
      assert Enum.sort(move_out) == [{10, "10"}, {20, "20"}]
    end

    @tag snapshot_data: [
           ~s({"key":"\\"public\\".\\"test_table\\"/\\"1\\"","value":{"id":"1","value":"10"},"headers":{"operation":"insert","tags":["tag1"]}}),
           ~s({"key":"\\"public\\".\\"test_table\\"/\\"2\\"","value":{"id":"2","value":"20"},"headers":{"operation":"insert","tags":["tag2"]}}),
           ~s({"headers":{"event":"move-out","patterns":[{"pos":0,"value":"tag1"}]}})
         ]
    test "on-load move_out event in snapshot data is processed correctly", ctx do
      ctx = with_materializer(ctx)

      # Only value 20 should remain after on-load processing of move_out
      assert Materializer.get_link_values(ctx) == MapSet.new([20])
      refute_received {:materializer_changes, _, _}
    end

    @tag snapshot_data: [
           ~s({"key":"\\"public\\".\\"test_table\\"/\\"1\\"","value":{"id":"1","value":"10"},"headers":{"operation":"insert","tags":["tag1"]}}),
           ~s({"key":"\\"public\\".\\"test_table\\"/\\"2\\"","value":{"id":"2","value":"10"},"headers":{"operation":"insert","tags":["tag2"]}}),
           ~s({"headers":{"event":"move-out","patterns":[{"pos":0,"value":"tag1"}]}})
         ]
    test "on-load move_out event with duplicate values keeps remaining row's value", ctx do
      ctx = with_materializer(ctx)

      # Value 10 should still be present because key "2" still has it
      assert Materializer.get_link_values(ctx) == MapSet.new([10])
      refute_received {:materializer_changes, _, _}
    end

    test "runtime move-in tags are tracked correctly if read from a storage range",
         %{
           shape_storage: shape_storage,
           writer: writer
         } = ctx do
      ctx = with_materializer(ctx)

      Storage.write_move_in_snapshot!(
        [
          [
            ~s("public"."test_table"/"1"),
            ["tag1"],
            ~s({"key":"\\"public\\".\\"test_table\\"/\\"1\\"","value":{"id":"1","value":"10"},"headers":{"operation":"insert","tags":["tag1"]}})
          ]
        ],
        "test",
        shape_storage
      )

      {range, writer} =
        Storage.append_move_in_snapshot_to_log!(
          "test",
          writer
        )

      Materializer.new_changes(ctx, range)

      assert Materializer.get_link_values(ctx) == MapSet.new([10])

      {range, _writer} =
        Storage.append_control_message!(
          Jason.encode!(%{headers: %{event: "move-out", patterns: [%{pos: 0, value: "tag1"}]}}),
          writer
        )

      Materializer.new_changes(ctx, range)

      assert Materializer.get_link_values(ctx) == MapSet.new()
    end
  end

  defp respond_to_call(request, response) do
    receive do
      {:"$gen_call", {from, ref}, {^request, _arg}} ->
        send(from, {ref, response})

      {:"$gen_call", {from, ref}, ^request} ->
        send(from, {ref, response})
    end
  end

  defp with_materializer(ctx, opts \\ []) do
    {:ok, _pid} =
      Materializer.start_link(%{
        stack_id: ctx.stack_id,
        shape_handle: ctx.shape_handle,
        storage: ctx.storage,
        columns: Keyword.get(opts, :columns, ["value"]),
        materialized_type: Keyword.get(opts, :materialized_type, {:array, :int8})
      })

    respond_to_call(:await_snapshot_start, :started)

    respond_to_call(
      :subscribe_materializer,
      {:ok, LogOffset.last_before_real_offsets()}
    )

    assert Materializer.wait_until_ready(ctx) == :ok
    Materializer.subscribe(ctx)

    ctx
  end

  defp make_snapshot_data(changes, opts \\ []) do
    pk_cols = Keyword.get(opts, :pk_cols, ["id"])

    changes
    |> prep_changes(opts)
    |> Enum.flat_map(&LogItems.from_change(&1, 1, pk_cols, :default))
    |> Enum.map(fn {_offset, item} -> Jason.encode!(item) end)
  end

  defp prep_changes(changes, opts \\ []) do
    pk_cols = Keyword.get(opts, :pk_cols, ["id"])
    relation = Keyword.get(opts, :relation, {"public", "test_table"})

    changes
    |> Enum.map(&Map.put(&1, :relation, relation))
    |> Enum.map(&Map.put(&1, :log_offset, LogOffset.first()))
    |> Enum.map(&Changes.fill_key(&1, pk_cols))
  end

  describe "startup offset coordination" do
    test "no duplicate when offset coordination prevents overlap", ctx do
      shape_handle = "offset-test-#{System.unique_integer()}"

      # Setup storage with a record at offset first()
      storage = Storage.for_shape(shape_handle, ctx.storage)
      Storage.start_link(storage)
      writer = Storage.init_writer!(storage, @shape)
      Storage.mark_snapshot_as_started(storage)

      first_offset = LogOffset.first()

      writer =
        Storage.append_to_log!(
          [
            {first_offset, ~s|"public"."test_table"/"1"|, :insert,
             ~s|{"key":"\\"public\\".\\"test_table\\"/\\"1\\"","value":{"id":"1","value":"10"},"headers":{"operation":"insert"}}|}
          ],
          writer
        )

      Storage.hibernate(writer)

      ConsumerRegistry.register_consumer(self(), shape_handle, ctx.stack_id)

      {:ok, _pid} =
        Materializer.start_link(%{
          stack_id: ctx.stack_id,
          shape_handle: shape_handle,
          storage: ctx.storage,
          columns: ["value"],
          materialized_type: {:array, :int8}
        })

      respond_to_call(:await_snapshot_start, :started)

      # Return offset BEFORE the record so the Materializer reads nothing from storage
      respond_to_call(:subscribe_materializer, {:ok, LogOffset.before_all()})

      mat_ctx = %{stack_id: ctx.stack_id, shape_handle: shape_handle}

      assert Materializer.wait_until_ready(mat_ctx) == :ok

      # Send the same record via new_changes — should NOT crash because
      # offset coordination ensured the Materializer didn't read it from storage
      Materializer.new_changes(mat_ctx, [
        %Changes.NewRecord{
          relation: {"public", "test_table"},
          key: ~s|"public"."test_table"/"1"|,
          record: %{"id" => "1", "value" => "10"},
          move_tags: []
        }
      ])

      assert Materializer.get_link_values(mat_ctx) == MapSet.new([10])
    end
  end

  describe "startup race condition handling" do
    # Tests for the race condition where Consumer dies between await_snapshot_start
    # and subscribe_materializer. See concurrency_analysis/MATERIALIZER_RACE_ANALYSIS.md

    test "shuts down gracefully when await_snapshot_start returns error",
         %{storage: storage, stack_id: stack_id, shape_handle: shape_handle} do
      # Trap exits so the test process doesn't die when Materializer shuts down
      Process.flag(:trap_exit, true)

      {:ok, pid} =
        Materializer.start_link(%{
          stack_id: stack_id,
          shape_handle: shape_handle,
          storage: storage,
          columns: ["value"],
          materialized_type: {:array, :int8}
        })

      ref = Process.monitor(pid)

      respond_to_call(:await_snapshot_start, {:error, "Consumer terminated"})

      assert_receive {:DOWN, ^ref, :process, ^pid, :shutdown}
    end

    test "shuts down gracefully when Consumer dies during await_snapshot_start call",
         %{storage: storage, stack_id: stack_id} do
      # This test exercises the try/catch by having the "consumer" die mid-call.
      # We spawn a short-lived process as the consumer that dies before responding.
      Process.flag(:trap_exit, true)

      # Use a unique shape handle for this test
      dying_handle = "dying-consumer-#{System.unique_integer()}"

      # Set up storage for the dying handle
      Storage.for_shape(dying_handle, storage) |> Storage.start_link()
      writer = Storage.for_shape(dying_handle, storage) |> Storage.init_writer!(@shape)
      Storage.for_shape(dying_handle, storage) |> Storage.mark_snapshot_as_started()
      Storage.hibernate(writer)
      Storage.for_shape(dying_handle, storage) |> then(&Storage.make_new_snapshot!([], &1))

      # Spawn a process that will die immediately when it receives the call
      dying_consumer =
        spawn(fn ->
          receive do
            {:"$gen_call", _from, :await_snapshot_start} ->
              # Die without responding - this causes GenServer.call to exit with :noproc
              exit(:normal)
          end
        end)

      # Register it as the consumer
      ConsumerRegistry.register_consumer(dying_consumer, dying_handle, stack_id)

      {:ok, pid} =
        Materializer.start_link(%{
          stack_id: stack_id,
          shape_handle: dying_handle,
          storage: storage,
          columns: ["value"],
          materialized_type: {:array, :int8}
        })

      ref = Process.monitor(pid)

      # The Materializer should shut down gracefully when the GenServer.call exits.
      # We accept :shutdown (normal case) or :noproc (if process exited before monitor was set up)
      assert_receive {:DOWN, ^ref, :process, ^pid, reason}, 1000
      assert reason in [:shutdown, :noproc]
    end

    test "shuts down gracefully when Consumer dies during subscribe_materializer call",
         %{storage: storage, stack_id: stack_id} do
      # This test exercises the try/catch for subscribe_materializer failure
      Process.flag(:trap_exit, true)

      dying_handle = "dying-consumer-subscribe-#{System.unique_integer()}"

      Storage.for_shape(dying_handle, storage) |> Storage.start_link()
      writer = Storage.for_shape(dying_handle, storage) |> Storage.init_writer!(@shape)
      Storage.for_shape(dying_handle, storage) |> Storage.mark_snapshot_as_started()
      Storage.hibernate(writer)
      Storage.for_shape(dying_handle, storage) |> then(&Storage.make_new_snapshot!([], &1))

      # Spawn a process that responds to await_snapshot_start but dies on subscribe
      dying_consumer =
        spawn(fn ->
          receive do
            {:"$gen_call", {from, ref}, :await_snapshot_start} ->
              # Respond successfully to await_snapshot_start
              send(from, {ref, :started})
          end

          receive do
            {:"$gen_call", _from, {:subscribe_materializer, _}} ->
              # Die without responding
              exit(:normal)
          end
        end)

      ConsumerRegistry.register_consumer(dying_consumer, dying_handle, stack_id)

      {:ok, pid} =
        Materializer.start_link(%{
          stack_id: stack_id,
          shape_handle: dying_handle,
          storage: storage,
          columns: ["value"],
          materialized_type: {:array, :int8}
        })

      ref = Process.monitor(pid)

      # We accept :shutdown (normal case) or :noproc (if process exited before monitor was set up)
      assert_receive {:DOWN, ^ref, :process, ^pid, reason}, 1000
      assert reason in [:shutdown, :noproc]
    end
  end
end
