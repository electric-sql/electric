defmodule Electric.Shapes.EventRouterTest do
  use ExUnit.Case

  alias Electric.Replication.Changes.Commit
  alias Electric.Replication.Changes.DeletedRecord
  alias Electric.Replication.Changes.NewRecord
  alias Electric.Replication.Changes.Relation
  alias Electric.Replication.Changes.TruncatedRelation
  alias Electric.Replication.Changes.UpdatedRecord
  alias Electric.Replication.Changes.TransactionFragment
  alias Electric.Shapes.EventRouter
  alias Electric.Shapes.Shape
  alias Support.StubInspector

  @inspector StubInspector.new(
               tables: ["t1", "t2", "t3", "table", "another_table"],
               columns: [
                 %{name: "id", type: "int8", pk_position: 0},
                 %{name: "value", type: "text"}
               ]
             )

  describe "event_by_shape_handle/2 with Relation events" do
    test "returns relation for all shapes on that table" do
      router =
        EventRouter.new()
        |> EventRouter.add_shape("s1", Shape.new!("t1", where: "id = 1", inspector: @inspector))
        |> EventRouter.add_shape("s2", Shape.new!("t1", where: "id = 2", inspector: @inspector))
        |> EventRouter.add_shape("s3", Shape.new!("t2", where: "id = 1", inspector: @inspector))

      relation = %Relation{schema: "public", table: "t1", id: 1, columns: []}

      {result, _router} = EventRouter.event_by_shape_handle(router, relation)

      assert result == %{"s1" => relation, "s2" => relation}
    end
  end

  describe "event_by_shape_handle/2 with single batch transactions" do
    test "returns empty map when no shapes match any changes" do
      router =
        EventRouter.new()
        |> EventRouter.add_shape("s1", Shape.new!("t1", where: "id = 1", inspector: @inspector))

      {result, _router} =
        EventRouter.event_by_shape_handle(router, %TransactionFragment{
          xid: 100,
          has_begin?: true,
          commit: %Commit{commit_timestamp: ~U[2024-01-01 00:00:00Z]},
          changes: [
            %NewRecord{relation: {"public", "t2"}, record: %{"id" => "2"}}
          ]
        })

      assert result == %{}
    end

    test "routes changes to matching shapes" do
      router =
        EventRouter.new()
        |> EventRouter.add_shape("s1", Shape.new!("t1", where: "id = 1", inspector: @inspector))
        |> EventRouter.add_shape("s2", Shape.new!("t1", where: "id = 2", inspector: @inspector))

      batch = %TransactionFragment{
        xid: 100,
        has_begin?: true,
        commit: %Commit{commit_timestamp: ~U[2024-01-01 00:00:00Z]},
        changes: [
          %NewRecord{relation: {"public", "t1"}, record: %{"id" => "1"}}
        ],
        affected_relations: MapSet.new([{"public", "t1"}]),
        change_count: 1
      }

      {result, _router} = EventRouter.event_by_shape_handle(router, batch)

      assert result == %{"s1" => batch}
    end

    test "complete transaction in single batch includes Begin and Commit for affected shapes" do
      router =
        EventRouter.new()
        |> EventRouter.add_shape("s1", Shape.new!("t1", where: "id = 1", inspector: @inspector))
        |> EventRouter.add_shape("s2", Shape.new!("t1", where: "id = 2", inspector: @inspector))

      insert1 = %NewRecord{relation: {"public", "t1"}, record: %{"id" => "1"}}
      insert2 = %NewRecord{relation: {"public", "t1"}, record: %{"id" => "2"}}
      commit_op = %Commit{commit_timestamp: ~U[2024-01-01 00:00:00Z]}

      batch = %TransactionFragment{
        xid: 100,
        has_begin?: true,
        commit: commit_op,
        changes: [insert1, insert2]
      }

      {result, _router} = EventRouter.event_by_shape_handle(router, batch)

      assert %{
               "s1" => %TransactionFragment{
                 has_begin?: true,
                 commit: ^commit_op,
                 changes: [^insert1]
               },
               "s2" => %TransactionFragment{
                 has_begin?: true,
                 commit: ^commit_op,
                 changes: [^insert2]
               }
             } = result
    end

    test "shapes without matching changes don't get Begin/Commit" do
      router =
        EventRouter.new()
        |> EventRouter.add_shape("s1", Shape.new!("t1", where: "id = 1", inspector: @inspector))
        |> EventRouter.add_shape("s2", Shape.new!("t1", where: "id = 2", inspector: @inspector))

      batch = %TransactionFragment{
        xid: 100,
        has_begin?: true,
        commit: %Commit{commit_timestamp: ~U[2024-01-01 00:00:00Z]},
        changes: [
          %NewRecord{relation: {"public", "t1"}, record: %{"id" => "1"}}
        ],
        affected_relations: MapSet.new([{"public", "t1"}]),
        change_count: 1
      }

      {result, _router} = EventRouter.event_by_shape_handle(router, batch)

      assert result == %{"s1" => batch}
    end

    test "change affecting multiple shapes appears in all their batches" do
      router =
        EventRouter.new()
        |> EventRouter.add_shape("s1", Shape.new!("t1", inspector: @inspector))
        |> EventRouter.add_shape("s2", Shape.new!("t1", where: "id = 1", inspector: @inspector))

      batch = %TransactionFragment{
        xid: 100,
        has_begin?: true,
        commit: %Commit{commit_timestamp: ~U[2024-01-01 00:00:00Z]},
        changes: [
          %NewRecord{relation: {"public", "t1"}, record: %{"id" => "1"}}
        ],
        affected_relations: MapSet.new([{"public", "t1"}]),
        change_count: 1
      }

      {result, _router} = EventRouter.event_by_shape_handle(router, batch)

      assert result == %{"s1" => batch, "s2" => batch}
    end

    test "preserves change order within each shape's batch" do
      router =
        EventRouter.new()
        |> EventRouter.add_shape("s1", Shape.new!("t1", where: "id = 1", inspector: @inspector))

      batch = %TransactionFragment{
        xid: 100,
        has_begin?: true,
        commit: %Commit{commit_timestamp: ~U[2024-01-01 00:00:00Z]},
        changes: [
          %NewRecord{relation: {"public", "t1"}, record: %{"id" => "1"}},
          %UpdatedRecord{
            relation: {"public", "t1"},
            record: %{"id" => "1"},
            old_record: %{"id" => "1"}
          },
          %DeletedRecord{relation: {"public", "t1"}, old_record: %{"id" => "1"}}
        ],
        affected_relations: MapSet.new([{"public", "t1"}]),
        change_count: 3
      }

      {result, _router} = EventRouter.event_by_shape_handle(router, batch)

      assert result == %{"s1" => batch}
    end

    test "handles updates affecting multiple shapes (old and new record)" do
      router =
        EventRouter.new()
        |> EventRouter.add_shape("s1", Shape.new!("t1", where: "id = 1", inspector: @inspector))
        |> EventRouter.add_shape("s2", Shape.new!("t1", where: "id = 2", inspector: @inspector))

      batch = %TransactionFragment{
        xid: 100,
        has_begin?: true,
        commit: %Commit{commit_timestamp: ~U[2024-01-01 00:00:00Z]},
        changes: [
          %UpdatedRecord{
            relation: {"public", "t1"},
            record: %{"id" => "2"},
            old_record: %{"id" => "1"}
          }
        ],
        affected_relations: MapSet.new([{"public", "t1"}]),
        change_count: 1
      }

      {result, _router} = EventRouter.event_by_shape_handle(router, batch)

      assert result == %{"s1" => batch, "s2" => batch}
    end

    test "handles deletes" do
      router =
        EventRouter.new()
        |> EventRouter.add_shape("s1", Shape.new!("t1", where: "id = 1", inspector: @inspector))
        |> EventRouter.add_shape("s2", Shape.new!("t1", where: "id = 2", inspector: @inspector))

      batch = %TransactionFragment{
        xid: 100,
        has_begin?: true,
        commit: %Commit{commit_timestamp: ~U[2024-01-01 00:00:00Z]},
        changes: [
          %DeletedRecord{relation: {"public", "t1"}, old_record: %{"id" => "1"}}
        ],
        affected_relations: MapSet.new([{"public", "t1"}]),
        change_count: 1
      }

      {result, _router} = EventRouter.event_by_shape_handle(router, batch)

      assert result == %{"s1" => batch}
    end

    test "handles truncations affecting all shapes for a table" do
      router =
        EventRouter.new()
        |> EventRouter.add_shape("s1", Shape.new!("t1", where: "id = 1", inspector: @inspector))
        |> EventRouter.add_shape("s2", Shape.new!("t1", where: "id = 2", inspector: @inspector))
        |> EventRouter.add_shape("s3", Shape.new!("t2", where: "id = 1", inspector: @inspector))

      batch = %TransactionFragment{
        xid: 100,
        has_begin?: true,
        commit: %Commit{commit_timestamp: ~U[2024-01-01 00:00:00Z]},
        changes: [
          %TruncatedRelation{relation: {"public", "t1"}}
        ],
        affected_relations: MapSet.new([{"public", "t1"}]),
        change_count: 1
      }

      {result, _router} = EventRouter.event_by_shape_handle(router, batch)

      assert result == %{"s1" => batch, "s2" => batch}
    end

    test "handles complex transaction with multiple tables and shapes" do
      router =
        EventRouter.new()
        |> EventRouter.add_shape("s1", Shape.new!("t1", where: "id = 1", inspector: @inspector))
        |> EventRouter.add_shape("s2", Shape.new!("t1", where: "id = 2", inspector: @inspector))
        |> EventRouter.add_shape("s3", Shape.new!("t2", where: "id = 1", inspector: @inspector))
        |> EventRouter.add_shape("s4", Shape.new!("t2", inspector: @inspector))

      insert_t1_1 = %NewRecord{relation: {"public", "t1"}, record: %{"id" => "1"}}
      insert_t1_2 = %NewRecord{relation: {"public", "t1"}, record: %{"id" => "2"}}
      insert_t2_1 = %NewRecord{relation: {"public", "t2"}, record: %{"id" => "1"}}
      insert_t2_3 = %NewRecord{relation: {"public", "t2"}, record: %{"id" => "3"}}
      commit_op = %Commit{commit_timestamp: ~U[2024-01-01 00:00:00Z]}

      batch = %TransactionFragment{
        xid: 100,
        has_begin?: true,
        commit: commit_op,
        changes: [insert_t1_1, insert_t1_2, insert_t2_1, insert_t2_3]
      }

      {result, _router} = EventRouter.event_by_shape_handle(router, batch)

      assert %{
               "s1" => %TransactionFragment{
                 has_begin?: true,
                 commit: ^commit_op,
                 changes: [^insert_t1_1]
               },
               "s2" => %TransactionFragment{
                 has_begin?: true,
                 commit: ^commit_op,
                 changes: [^insert_t1_2]
               },
               "s3" => %TransactionFragment{
                 has_begin?: true,
                 commit: ^commit_op,
                 changes: [^insert_t2_1]
               },
               "s4" => %TransactionFragment{
                 has_begin?: true,
                 commit: ^commit_op,
                 changes: [^insert_t2_1, ^insert_t2_3]
               }
             } = result
    end

    test "sets affected_relations from the changes in the fragment" do
      router =
        EventRouter.new()
        |> EventRouter.add_shape("s1", Shape.new!("t1", inspector: @inspector))
        |> EventRouter.add_shape("s2", Shape.new!("t2", inspector: @inspector))

      insert_t1 = %NewRecord{relation: {"public", "t1"}, record: %{"id" => "1"}}
      insert_t2 = %NewRecord{relation: {"public", "t2"}, record: %{"id" => "1"}}
      commit_op = %Commit{commit_timestamp: ~U[2024-01-01 00:00:00Z]}

      batch = %TransactionFragment{
        xid: 100,
        has_begin?: true,
        commit: commit_op,
        changes: [insert_t1, insert_t2]
      }

      {result, _router} = EventRouter.event_by_shape_handle(router, batch)

      assert %{
               "s1" => %TransactionFragment{affected_relations: s1_relations},
               "s2" => %TransactionFragment{affected_relations: s2_relations}
             } = result

      assert s1_relations == MapSet.new([{"public", "t1"}])
      assert s2_relations == MapSet.new([{"public", "t2"}])
    end

    test "batch with only Begin and Commit but no data changes" do
      router =
        EventRouter.new()
        |> EventRouter.add_shape("s1", Shape.new!("t1", where: "id = 1", inspector: @inspector))

      {result, _router} =
        EventRouter.event_by_shape_handle(router, %TransactionFragment{
          xid: 100,
          has_begin?: true,
          commit: %Commit{commit_timestamp: ~U[2024-01-01 00:00:00Z]},
          changes: []
        })

      assert result == %{}
    end
  end

  describe "event_by_shape_handle/2 with multi-batch transactions" do
    test "first batch with Begin only - no output until data changes" do
      router =
        EventRouter.new()
        |> EventRouter.add_shape("s1", Shape.new!("t1", where: "id = 1", inspector: @inspector))

      {result, _router} =
        EventRouter.event_by_shape_handle(
          router,
          %TransactionFragment{xid: 100, has_begin?: true, changes: []}
        )

      assert result == %{}
    end

    test "Begin in first batch, data in second batch - Begin included in second batch output" do
      router =
        EventRouter.new()
        |> EventRouter.add_shape("s1", Shape.new!("t1", where: "id = 1", inspector: @inspector))

      batch1 = %TransactionFragment{xid: 100, has_begin?: true, changes: []}

      {result1, router} = EventRouter.event_by_shape_handle(router, batch1)
      assert result1 == %{}

      insert = %NewRecord{relation: {"public", "t1"}, record: %{"id" => "1"}}
      batch2 = %TransactionFragment{xid: 100, has_begin?: false, changes: [insert]}

      {result2, _router} = EventRouter.event_by_shape_handle(router, batch2)

      assert %{
               "s1" => %TransactionFragment{has_begin?: true, changes: [^insert]}
             } = result2
    end

    test "Begin seen once per shape even across multiple batches" do
      router =
        EventRouter.new()
        |> EventRouter.add_shape("s1", Shape.new!("t1", where: "id = 1", inspector: @inspector))

      insert1 = %NewRecord{relation: {"public", "t1"}, record: %{"id" => "1"}}
      t1_relations = MapSet.new([{"public", "t1"}])

      batch1 = %TransactionFragment{
        xid: 100,
        has_begin?: true,
        changes: [insert1],
        affected_relations: t1_relations,
        change_count: 1
      }

      {result1, router} = EventRouter.event_by_shape_handle(router, batch1)
      assert result1 == %{"s1" => batch1}

      insert2 = %NewRecord{relation: {"public", "t1"}, record: %{"id" => "1"}}

      batch2 = %TransactionFragment{
        xid: 100,
        has_begin?: false,
        changes: [insert2],
        affected_relations: t1_relations,
        change_count: 1
      }

      {result2, _router} = EventRouter.event_by_shape_handle(router, batch2)

      assert result2 == %{"s1" => batch2}
    end

    test "shape first sees data in second batch gets Begin" do
      router =
        EventRouter.new()
        |> EventRouter.add_shape("s1", Shape.new!("t1", where: "id = 1", inspector: @inspector))
        |> EventRouter.add_shape("s2", Shape.new!("t1", where: "id = 2", inspector: @inspector))

      insert1 = %NewRecord{relation: {"public", "t1"}, record: %{"id" => "1"}}
      batch1 = %TransactionFragment{xid: 100, has_begin?: true, changes: [insert1]}

      {result1, router} = EventRouter.event_by_shape_handle(router, batch1)
      assert %{"s1" => %TransactionFragment{has_begin?: true, changes: [^insert1]}} = result1

      insert2 = %NewRecord{relation: {"public", "t1"}, record: %{"id" => "2"}}
      batch2 = %TransactionFragment{xid: 100, has_begin?: false, changes: [insert2]}

      {result2, _router} = EventRouter.event_by_shape_handle(router, batch2)

      assert %{"s2" => %TransactionFragment{has_begin?: true, changes: [^insert2]}} = result2
    end

    test "Commit only sent to shapes that received changes in the transaction" do
      router =
        EventRouter.new()
        |> EventRouter.add_shape("s1", Shape.new!("t1", where: "id = 1", inspector: @inspector))
        |> EventRouter.add_shape("s2", Shape.new!("t1", where: "id = 2", inspector: @inspector))
        |> EventRouter.add_shape("s3", Shape.new!("t1", where: "id = 3", inspector: @inspector))

      insert1 = %NewRecord{relation: {"public", "t1"}, record: %{"id" => "1"}}
      batch1 = %TransactionFragment{xid: 100, has_begin?: true, changes: [insert1]}

      {result1, router} = EventRouter.event_by_shape_handle(router, batch1)

      assert %{"s1" => %TransactionFragment{has_begin?: true, changes: [^insert1]}} = result1

      insert2 = %NewRecord{relation: {"public", "t1"}, record: %{"id" => "2"}}
      commit_op = %Commit{commit_timestamp: ~U[2024-01-01 00:00:00Z]}

      batch2 = %TransactionFragment{
        xid: 100,
        has_begin?: false,
        commit: commit_op,
        changes: [insert2]
      }

      {result2, _router} = EventRouter.event_by_shape_handle(router, batch2)

      assert %{
               "s1" => %TransactionFragment{has_begin?: false, commit: ^commit_op, changes: []},
               "s2" => %TransactionFragment{
                 has_begin?: true,
                 commit: ^commit_op,
                 changes: [^insert2]
               }
             } = result2
    end

    test "Commit in separate batch from all data" do
      router =
        EventRouter.new()
        |> EventRouter.add_shape("s1", Shape.new!("t1", where: "id = 1", inspector: @inspector))

      insert = %NewRecord{relation: {"public", "t1"}, record: %{"id" => "1"}}
      t1_relations = MapSet.new([{"public", "t1"}])

      batch1 = %TransactionFragment{
        xid: 100,
        has_begin?: true,
        changes: [insert],
        affected_relations: t1_relations,
        change_count: 1
      }

      {result1, router} = EventRouter.event_by_shape_handle(router, batch1)
      assert result1 == %{"s1" => batch1}

      commit_op = %Commit{commit_timestamp: ~U[2024-01-01 00:00:00Z]}
      batch2 = %TransactionFragment{xid: 100, has_begin?: false, commit: commit_op, changes: []}

      {result2, _router} = EventRouter.event_by_shape_handle(router, batch2)

      assert result2 == %{"s1" => batch2}
    end

    test "transaction state is reset after Commit" do
      router =
        EventRouter.new()
        |> EventRouter.add_shape("s1", Shape.new!("t1", where: "id = 1", inspector: @inspector))

      insert1 = %NewRecord{relation: {"public", "t1"}, record: %{"id" => "1"}}
      commit1 = %Commit{commit_timestamp: ~U[2024-01-01 00:00:00Z]}
      t1_relations = MapSet.new([{"public", "t1"}])

      batch1 = %TransactionFragment{
        xid: 100,
        has_begin?: true,
        commit: commit1,
        changes: [insert1],
        affected_relations: t1_relations,
        change_count: 1
      }

      {result1, router} = EventRouter.event_by_shape_handle(router, batch1)
      assert result1 == %{"s1" => batch1}

      insert2 = %NewRecord{relation: {"public", "t1"}, record: %{"id" => "1"}}
      commit2 = %Commit{commit_timestamp: ~U[2024-01-01 00:01:00Z]}

      batch2 = %TransactionFragment{
        xid: 101,
        has_begin?: true,
        commit: commit2,
        changes: [insert2],
        affected_relations: t1_relations,
        change_count: 1
      }

      {result2, _router} = EventRouter.event_by_shape_handle(router, batch2)

      assert result2 == %{"s1" => batch2}
    end

    test "multiple batches with data spread across them" do
      router =
        EventRouter.new()
        |> EventRouter.add_shape("s1", Shape.new!("t1", where: "id = 1", inspector: @inspector))

      insert1 = %NewRecord{relation: {"public", "t1"}, record: %{"id" => "1"}}
      t1_relations = MapSet.new([{"public", "t1"}])

      batch1 = %TransactionFragment{
        xid: 100,
        has_begin?: true,
        changes: [insert1],
        affected_relations: t1_relations,
        change_count: 1
      }

      {result1, router} = EventRouter.event_by_shape_handle(router, batch1)
      assert result1 == %{"s1" => batch1}

      insert2 = %NewRecord{relation: {"public", "t1"}, record: %{"id" => "1"}}

      batch2 = %TransactionFragment{
        xid: 100,
        has_begin?: false,
        changes: [insert2],
        affected_relations: t1_relations,
        change_count: 1
      }

      {result2, router} = EventRouter.event_by_shape_handle(router, batch2)
      assert result2 == %{"s1" => batch2}

      insert3 = %NewRecord{relation: {"public", "t1"}, record: %{"id" => "1"}}
      commit_op = %Commit{commit_timestamp: ~U[2024-01-01 00:00:00Z]}

      batch3 = %TransactionFragment{
        xid: 100,
        has_begin?: false,
        commit: commit_op,
        changes: [insert3],
        affected_relations: t1_relations,
        change_count: 1
      }

      {result3, _router} = EventRouter.event_by_shape_handle(router, batch3)

      assert result3 == %{"s1" => batch3}
    end

    test "multi-batch transaction with different shapes seeing data at different times" do
      router =
        EventRouter.new()
        |> EventRouter.add_shape("s1", Shape.new!("t1", where: "id = 1", inspector: @inspector))
        |> EventRouter.add_shape("s2", Shape.new!("t1", where: "id = 2", inspector: @inspector))
        |> EventRouter.add_shape("s3", Shape.new!("t1", where: "id = 3", inspector: @inspector))

      insert1 = %NewRecord{relation: {"public", "t1"}, record: %{"id" => "1"}}
      batch1 = %TransactionFragment{xid: 100, has_begin?: true, changes: [insert1]}

      {result1, router} = EventRouter.event_by_shape_handle(router, batch1)
      assert %{"s1" => %TransactionFragment{has_begin?: true, changes: [^insert1]}} = result1

      insert2 = %NewRecord{relation: {"public", "t1"}, record: %{"id" => "2"}}
      insert3 = %NewRecord{relation: {"public", "t1"}, record: %{"id" => "3"}}
      batch2 = %TransactionFragment{xid: 100, has_begin?: false, changes: [insert2, insert3]}

      {result2, router} = EventRouter.event_by_shape_handle(router, batch2)

      assert %{
               "s2" => %TransactionFragment{has_begin?: true, changes: [^insert2]},
               "s3" => %TransactionFragment{has_begin?: true, changes: [^insert3]}
             } = result2

      insert1b = %NewRecord{relation: {"public", "t1"}, record: %{"id" => "1"}}
      commit_op = %Commit{commit_timestamp: ~U[2024-01-01 00:00:00Z]}

      batch3 = %TransactionFragment{
        xid: 100,
        has_begin?: false,
        commit: commit_op,
        changes: [insert1b]
      }

      {result3, _router} = EventRouter.event_by_shape_handle(router, batch3)

      assert %{
               "s1" => %TransactionFragment{
                 has_begin?: false,
                 commit: ^commit_op,
                 changes: [^insert1b]
               },
               "s2" => %TransactionFragment{has_begin?: false, commit: ^commit_op, changes: []},
               "s3" => %TransactionFragment{has_begin?: false, commit: ^commit_op, changes: []}
             } = result3
    end
  end

  describe "edge cases" do
    test "adding shape during transaction skips current transaction for new shape" do
      router =
        EventRouter.new()
        |> EventRouter.add_shape("s1", Shape.new!("t1", where: "id = 1", inspector: @inspector))

      insert1a = %NewRecord{relation: {"public", "t1"}, record: %{"id" => "1"}}
      insert2a = %NewRecord{relation: {"public", "t1"}, record: %{"id" => "2"}}

      {result1, router} =
        EventRouter.event_by_shape_handle(
          router,
          %TransactionFragment{xid: 100, has_begin?: true, changes: [insert1a, insert2a]}
        )

      assert %{"s1" => %TransactionFragment{has_begin?: true, changes: [^insert1a]}} = result1

      # Shape s2 added mid-transaction - should not receive any events from this transaction
      # because it may have missed earlier changes that affected it (and in this example it
      # did miss a change that affected it, namely insert2a above)
      router =
        EventRouter.add_shape(
          router,
          "s2",
          Shape.new!("t1", where: "id = 2", inspector: @inspector)
        )

      insert1b = %NewRecord{relation: {"public", "t1"}, record: %{"id" => "1"}}
      insert2b = %NewRecord{relation: {"public", "t1"}, record: %{"id" => "2"}}
      commit1 = %Commit{commit_timestamp: ~U[2024-01-01 00:00:00Z]}

      {result2, router} =
        EventRouter.event_by_shape_handle(
          router,
          %TransactionFragment{
            xid: 100,
            has_begin?: false,
            commit: commit1,
            changes: [insert1b, insert2b]
          }
        )

      # s1 gets its changes + commit, s2 gets nothing (added mid-transaction)
      assert %{
               "s1" => %TransactionFragment{
                 has_begin?: false,
                 commit: ^commit1,
                 changes: [^insert1b]
               }
             } = result2

      # Next transaction - both shapes should receive their events
      insert1c = %NewRecord{relation: {"public", "t1"}, record: %{"id" => "1"}}
      insert2c = %NewRecord{relation: {"public", "t1"}, record: %{"id" => "2"}}
      commit2 = %Commit{commit_timestamp: ~U[2024-01-01 00:01:00Z]}

      {result3, _router} =
        EventRouter.event_by_shape_handle(
          router,
          %TransactionFragment{
            xid: 101,
            has_begin?: true,
            commit: commit2,
            changes: [insert1c, insert2c]
          }
        )

      assert %{
               "s1" => %TransactionFragment{
                 has_begin?: true,
                 commit: ^commit2,
                 changes: [^insert1c]
               },
               "s2" => %TransactionFragment{
                 has_begin?: true,
                 commit: ^commit2,
                 changes: [^insert2c]
               }
             } = result3
    end

    test "adding multiple shapes during transaction skips current transaction for all new shapes" do
      router =
        EventRouter.new()
        |> EventRouter.add_shape("s1", Shape.new!("t1", where: "id = 1", inspector: @inspector))

      insert1a = %NewRecord{relation: {"public", "t1"}, record: %{"id" => "1"}}
      insert2a = %NewRecord{relation: {"public", "t1"}, record: %{"id" => "2"}}

      {result1, router} =
        EventRouter.event_by_shape_handle(
          router,
          %TransactionFragment{xid: 100, has_begin?: true, changes: [insert1a, insert2a]}
        )

      assert %{"s1" => %TransactionFragment{has_begin?: true, changes: [^insert1a]}} = result1

      # Shapes s2 and s3 added mid-transaction - neither should receive any events from this
      # transaction because they may have missed earlier changes that affected them (and in
      # this example s2 did miss a change that affected it, namely insert2a above)
      router =
        router
        |> EventRouter.add_shape("s2", Shape.new!("t1", where: "id = 2", inspector: @inspector))
        |> EventRouter.add_shape("s3", Shape.new!("t1", where: "id = 3", inspector: @inspector))

      insert1b = %NewRecord{relation: {"public", "t1"}, record: %{"id" => "1"}}
      insert2b = %NewRecord{relation: {"public", "t1"}, record: %{"id" => "2"}}
      insert3b = %NewRecord{relation: {"public", "t1"}, record: %{"id" => "3"}}
      commit1 = %Commit{commit_timestamp: ~U[2024-01-01 00:00:00Z]}

      {result2, router} =
        EventRouter.event_by_shape_handle(
          router,
          %TransactionFragment{
            xid: 100,
            has_begin?: false,
            commit: commit1,
            changes: [insert1b, insert2b, insert3b]
          }
        )

      # s1 gets its changes + commit, s2 and s3 get nothing (added mid-transaction)
      assert %{
               "s1" => %TransactionFragment{
                 has_begin?: false,
                 commit: ^commit1,
                 changes: [^insert1b]
               }
             } = result2

      # Next transaction - all shapes should receive their events
      insert1c = %NewRecord{relation: {"public", "t1"}, record: %{"id" => "1"}}
      insert2c = %NewRecord{relation: {"public", "t1"}, record: %{"id" => "2"}}
      insert3c = %NewRecord{relation: {"public", "t1"}, record: %{"id" => "3"}}
      commit2 = %Commit{commit_timestamp: ~U[2024-01-01 00:01:00Z]}

      {result3, _router} =
        EventRouter.event_by_shape_handle(
          router,
          %TransactionFragment{
            xid: 101,
            has_begin?: true,
            commit: commit2,
            changes: [insert1c, insert2c, insert3c]
          }
        )

      assert %{
               "s1" => %TransactionFragment{
                 has_begin?: true,
                 commit: ^commit2,
                 changes: [^insert1c]
               },
               "s2" => %TransactionFragment{
                 has_begin?: true,
                 commit: ^commit2,
                 changes: [^insert2c]
               },
               "s3" => %TransactionFragment{
                 has_begin?: true,
                 commit: ^commit2,
                 changes: [^insert3c]
               }
             } = result3
    end

    test "removing shape during transaction stops events for that shape immediately" do
      router =
        EventRouter.new()
        |> EventRouter.add_shape("s1", Shape.new!("t1", where: "id = 1", inspector: @inspector))
        |> EventRouter.add_shape("s2", Shape.new!("t1", where: "id = 2", inspector: @inspector))

      insert1a = %NewRecord{relation: {"public", "t1"}, record: %{"id" => "1"}}
      insert2a = %NewRecord{relation: {"public", "t1"}, record: %{"id" => "2"}}

      {result1, router} =
        EventRouter.event_by_shape_handle(
          router,
          %TransactionFragment{xid: 100, has_begin?: true, changes: [insert1a, insert2a]}
        )

      assert %{
               "s1" => %TransactionFragment{has_begin?: true, changes: [^insert1a]},
               "s2" => %TransactionFragment{has_begin?: true, changes: [^insert2a]}
             } = result1

      # s1 removed mid-transaction - should receive no more events
      router = EventRouter.remove_shape(router, "s1")

      insert1b = %NewRecord{relation: {"public", "t1"}, record: %{"id" => "1"}}
      insert2b = %NewRecord{relation: {"public", "t1"}, record: %{"id" => "2"}}
      commit1 = %Commit{commit_timestamp: ~U[2024-01-01 00:00:00Z]}

      {result2, _router} =
        EventRouter.event_by_shape_handle(
          router,
          %TransactionFragment{
            xid: 100,
            has_begin?: false,
            commit: commit1,
            changes: [insert1b, insert2b]
          }
        )

      # s1 gets nothing (removed), s2 gets its changes + commit
      assert %{
               "s2" => %TransactionFragment{
                 has_begin?: false,
                 commit: ^commit1,
                 changes: [^insert2b]
               }
             } = result2
    end

    test "shape added and removed mid-transaction receives no events" do
      router =
        EventRouter.new()
        |> EventRouter.add_shape("s1", Shape.new!("t1", where: "id = 1", inspector: @inspector))

      insert1a = %NewRecord{relation: {"public", "t1"}, record: %{"id" => "1"}}
      insert2a = %NewRecord{relation: {"public", "t1"}, record: %{"id" => "2"}}

      {result1, router} =
        EventRouter.event_by_shape_handle(
          router,
          %TransactionFragment{xid: 100, has_begin?: true, changes: [insert1a, insert2a]}
        )

      assert %{"s1" => %TransactionFragment{has_begin?: true, changes: [^insert1a]}} = result1

      # s2 added mid-transaction
      router =
        EventRouter.add_shape(
          router,
          "s2",
          Shape.new!("t1", where: "id = 2", inspector: @inspector)
        )

      insert1b = %NewRecord{relation: {"public", "t1"}, record: %{"id" => "1"}}
      insert2b = %NewRecord{relation: {"public", "t1"}, record: %{"id" => "2"}}

      {result2, router} =
        EventRouter.event_by_shape_handle(
          router,
          %TransactionFragment{xid: 100, has_begin?: false, changes: [insert1b, insert2b]}
        )

      # s2 skipped because added mid-transaction
      assert %{"s1" => %TransactionFragment{has_begin?: false, changes: [^insert1b]}} = result2

      # s2 removed before transaction ends
      router = EventRouter.remove_shape(router, "s2")

      insert1c = %NewRecord{relation: {"public", "t1"}, record: %{"id" => "1"}}
      insert2c = %NewRecord{relation: {"public", "t1"}, record: %{"id" => "2"}}
      commit1 = %Commit{commit_timestamp: ~U[2024-01-01 00:00:00Z]}

      {result3, router} =
        EventRouter.event_by_shape_handle(
          router,
          %TransactionFragment{
            xid: 100,
            has_begin?: false,
            commit: commit1,
            changes: [insert1c, insert2c]
          }
        )

      # s2 removed, so only s1 gets events
      assert %{
               "s1" => %TransactionFragment{
                 has_begin?: false,
                 commit: ^commit1,
                 changes: [^insert1c]
               }
             } = result3

      # Next transaction - s2 is gone, only s1 receives events
      insert1d = %NewRecord{relation: {"public", "t1"}, record: %{"id" => "1"}}
      insert2d = %NewRecord{relation: {"public", "t1"}, record: %{"id" => "2"}}
      commit2 = %Commit{commit_timestamp: ~U[2024-01-01 00:01:00Z]}

      {result4, _router} =
        EventRouter.event_by_shape_handle(
          router,
          %TransactionFragment{
            xid: 101,
            has_begin?: true,
            commit: commit2,
            changes: [insert1d, insert2d]
          }
        )

      assert %{
               "s1" => %TransactionFragment{
                 has_begin?: true,
                 commit: ^commit2,
                 changes: [^insert1d]
               }
             } = result4
    end
  end
end
