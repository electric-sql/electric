defmodule Electric.Replication.OperationBatcherTest do
  use ExUnit.Case, async: true

  alias Electric.Replication.OperationBatcher

  alias Electric.Replication.Changes.{
    Begin,
    Commit,
    Relation,
    NewRecord,
    UpdatedRecord
  }

  @max_batch_size 4

  describe "batch/2" do
    test "returns a batch as soon as a commit is seen" do
      batcher = OperationBatcher.new(@max_batch_size)

      assert {[], batcher} = OperationBatcher.batch([%Begin{}], batcher)
      assert {[], batcher} = OperationBatcher.batch([%NewRecord{}], batcher)

      assert {[%Begin{}, %NewRecord{}, %Commit{}], _batcher} =
               OperationBatcher.batch([%Commit{}], batcher)
    end

    test "returns a batch as soon as a relation is seen" do
      batcher = OperationBatcher.new(@max_batch_size)

      assert {[%Relation{}], _batcher} = OperationBatcher.batch([%Relation{}], batcher)
    end

    test "returns a batch once the max batch size has been reached" do
      batcher = OperationBatcher.new(@max_batch_size)

      assert {[], batcher} = OperationBatcher.batch([%Begin{}], batcher)
      assert {[], batcher} = OperationBatcher.batch([%NewRecord{}], batcher)
      assert {[], batcher} = OperationBatcher.batch([%NewRecord{}], batcher)

      assert {[%Begin{}, %NewRecord{}, %NewRecord{}, %NewRecord{}], _batcher} =
               OperationBatcher.batch([%NewRecord{}], batcher)
    end

    test "returns all operations it is given even if that's over the max batch size" do
      batcher = OperationBatcher.new(@max_batch_size)

      operations = [
        %Begin{},
        %NewRecord{},
        %UpdatedRecord{},
        %NewRecord{},
        %UpdatedRecord{},
        %NewRecord{}
      ]

      assert {^operations, _batcher} = OperationBatcher.batch(operations, batcher)
    end
  end
end
