defmodule Electric.Shapes.Consumer.EventHandler.DefaultTest do
  use ExUnit.Case, async: true

  alias Electric.Postgres.Lsn
  alias Electric.Replication.Changes
  alias Electric.Replication.Changes.Transaction
  alias Electric.Shapes.Consumer.Effects
  alias Electric.Shapes.Consumer.EventHandler
  alias Electric.Shapes.Shape

  @inspector Support.StubInspector.new(
               tables: ["child"],
               columns: [
                 %{name: "id", type: "int8", pk_position: 0, type_id: {20, 1}},
                 %{name: "parent_id", type: "int8", pk_position: nil, type_id: {20, 1}},
                 %{name: "name", type: "text", pk_position: nil, type_id: {28, 1}}
               ]
             )

  test "returns notify flushed effect for empty transaction" do
    handler = %EventHandler.Default{
      shape: simple_shape(),
      stack_id: "stack-id",
      shape_handle: "shape-handle"
    }

    txn = %Transaction{
      xid: 1,
      changes: [],
      num_changes: 0,
      lsn: lsn(1),
      last_log_offset: Electric.Replication.LogOffset.new(lsn(1), 0)
    }

    assert {:ok, %EventHandler.Default{}, [%Effects.NotifyFlushed{log_offset: offset}]} =
             EventHandler.handle_event(handler, txn)

    assert offset != nil
  end

  test "ignores global_last_seen_lsn" do
    handler = %EventHandler.Default{
      shape: simple_shape(),
      stack_id: "stack-id",
      shape_handle: "shape-handle"
    }

    assert {:ok, %EventHandler.Default{}, []} =
             EventHandler.handle_event(handler, {:global_last_seen_lsn, 42})
  end

  test "returns truncate error on TruncatedRelation" do
    handler = %EventHandler.Default{
      shape: simple_shape(),
      stack_id: "stack-id",
      shape_handle: "shape-handle"
    }

    assert {:error, {:truncate, 1}} =
             EventHandler.handle_event(handler, txn(1, [child_truncate()]))
  end

  test "marks the final emitted change as last" do
    handler = %EventHandler.Default{
      shape: simple_shape(),
      stack_id: "stack-id",
      shape_handle: "shape-handle"
    }

    assert {:ok, %EventHandler.Default{},
            [
              %Effects.AppendChanges{
                xid: 1,
                changes: [%Changes.NewRecord{record: %{"id" => "1"}, last?: true}]
              },
              %Effects.NotifyFlushed{}
            ]} = EventHandler.handle_event(handler, txn(1, [child_insert("1")]))
  end

  defp simple_shape do
    Shape.new!("child", inspector: @inspector)
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

  defp child_truncate do
    %Changes.TruncatedRelation{relation: {"public", "child"}}
  end

  defp child_insert(id) do
    %Changes.NewRecord{
      relation: {"public", "child"},
      record: %{"id" => id, "parent_id" => "1", "name" => "child-#{id}"}
    }
  end
end
