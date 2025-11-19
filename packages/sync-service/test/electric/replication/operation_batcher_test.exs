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
      batcher = OperationBatcher.new()

      assert {[], batcher} = OperationBatcher.batch([%Begin{}], @max_batch_size, batcher)
      assert {[], batcher} = OperationBatcher.batch([%NewRecord{}], @max_batch_size, batcher)

      assert {[%Begin{}, %NewRecord{}, %Commit{}], _batcher} =
               OperationBatcher.batch([%Commit{}], @max_batch_size, batcher)
    end

    test "returns a batch as soon as a relation is seen" do
      batcher = OperationBatcher.new()

      assert {[%Relation{}], _batcher} =
               OperationBatcher.batch([%Relation{}], @max_batch_size, batcher)
    end

    test "returns a batch once the max batch size has been reached" do
      batcher = OperationBatcher.new()

      assert {[], batcher} = OperationBatcher.batch([%Begin{}], @max_batch_size, batcher)
      assert {[], batcher} = OperationBatcher.batch([%NewRecord{}], @max_batch_size, batcher)
      assert {[], batcher} = OperationBatcher.batch([%NewRecord{}], @max_batch_size, batcher)

      assert {[%Begin{}, %NewRecord{}, %NewRecord{}, %NewRecord{}], _batcher} =
               OperationBatcher.batch([%NewRecord{}], @max_batch_size, batcher)
    end

    test "returns all operations it is given even if that's over the max batch size" do
      batcher = OperationBatcher.new()

      operations = [
        %Begin{},
        %NewRecord{},
        %UpdatedRecord{},
        %NewRecord{},
        %UpdatedRecord{},
        %NewRecord{}
      ]

      assert {^operations, _batcher} =
               OperationBatcher.batch(operations, @max_batch_size, batcher)
    end
  end
end
