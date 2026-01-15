defmodule Electric.ShapeCache.PureFileStorageRaceTest do
  @moduledoc """
  Test demonstrating the ETS read/write race condition in PureFileStorage.

  Bug location:
  - lib/electric/shape_cache/pure_file_storage.ex:1115-1156 (stream_main_log)
  - lib/electric/shape_cache/pure_file_storage/write_loop.ex:312-340 (flush_buffer)

  The Race:
  1. Reader reads metadata: `last_persisted = X`
  2. Reader decides to read from ETS (because `min_offset > X`)
  3. Writer flushes buffer, updates `last_persisted = Y`, clears ETS
  4. Reader tries to read from ETS - gets EMPTY instead of data!

  The data is now on disk, but reader used stale metadata to decide
  where to read from, and ETS was cleared before reader could access it.
  """
  use ExUnit.Case, async: true

  import Support.ComponentSetup
  import Electric.ShapeCache.PureFileStorage.SharedRecords

  alias Electric.Replication.LogOffset
  alias Electric.ShapeCache.Storage
  alias Electric.ShapeCache.PureFileStorage
  alias Electric.ShapeCache.PureFileStorage.WriteLoop
  alias Electric.Shapes.Shape

  @moduletag :tmp_dir

  setup [:with_stack_id_from_test, :with_async_deleter]

  @shape_handle "race-test-shape"
  @shape %Shape{
    root_table: {"public", "items"},
    root_table_id: 1,
    root_pk: ["id"],
    selected_columns: ["id"],
    explicitly_selected_columns: ["id"]
  }

  setup ctx do
    base_opts =
      PureFileStorage.shared_opts(
        stack_id: ctx.stack_id,
        storage_dir: ctx.tmp_dir,
        # Large threshold so data stays in buffer
        chunk_bytes_threshold: 10 * 1024 * 1024,
        # Long period so we control when flush happens
        flush_period: 60_000
      )

    storage_base = {PureFileStorage, base_opts}
    start_link_supervised!(Storage.stack_child_spec(storage_base))

    opts = PureFileStorage.for_shape(@shape_handle, base_opts)

    %{base_opts: base_opts, opts: opts}
  end

  describe "ETS read/write race condition" do
    @tag :race_condition_bug
    test "reader can miss data when ETS is cleared between metadata read and data read", ctx do
      %{opts: opts, stack_id: stack_id} = ctx

      # Step 1: Initialize writer with snapshot
      writer = PureFileStorage.init_writer!(opts, @shape)
      PureFileStorage.set_pg_snapshot(%{xmin: 100}, opts)
      PureFileStorage.mark_snapshot_as_started(opts)
      PureFileStorage.make_new_snapshot!([], opts)

      # Step 2: Write some data to the buffer (NOT flushed to disk yet)
      # This data will be in ETS but not on disk
      writer =
        PureFileStorage.append_to_log!(
          [
            {LogOffset.new(10, 0), "key1", :insert, ~S|{"id": "1"}|},
            {LogOffset.new(10, 1), "key2", :insert, ~S|{"id": "2"}|}
          ],
          writer
        )

      # Step 3: Read metadata snapshot (simulates what stream_main_log does)
      # At this point: last_persisted = before_real_offsets, last_seen = (10, 1)
      stack_ets = PureFileStorage.stack_ets(stack_id)

      [storage_meta(
         ets_table: ets_ref,
         last_persisted_offset: last_persisted_before,
         last_seen_txn_offset: last_seen_before
       )] = :ets.lookup(stack_ets, @shape_handle)

      # Verify data is in ETS buffer
      assert ets_ref != nil
      assert last_persisted_before == LogOffset.last_before_real_offsets()
      assert last_seen_before == LogOffset.new(10, 1)

      # Data should be visible in ETS at this point
      ets_data_before_flush = :ets.tab2list(ets_ref)
      assert length(ets_data_before_flush) == 2

      # Step 4: Simulate writer flush (this clears ETS!)
      # In real code, this happens in a different process/timing
      writer_state(writer_acc: acc) = writer

      # Manually trigger flush - this is what happens when flush_buffer is called
      flushed_acc = WriteLoop.flush_buffer(acc, writer)

      # Step 5: Verify ETS was cleared
      ets_data_after_flush = :ets.tab2list(ets_ref)
      assert ets_data_after_flush == [], "ETS should be empty after flush"

      # Step 6: Verify metadata was updated
      [storage_meta(last_persisted_offset: last_persisted_after)] =
        :ets.lookup(stack_ets, @shape_handle)

      assert last_persisted_after == LogOffset.new(10, 1),
             "last_persisted should be updated after flush"

      # Step 7: THE BUG - If a reader used the OLD metadata (last_persisted_before)
      # to decide to read from ETS, it would now get empty results!

      # Simulate what the reader would do with stale metadata:
      # Since min_offset (10, 0) > last_persisted_before (before_real_offsets),
      # it would try to read from ETS. But ETS is now empty!

      min_offset = LogOffset.new(10, 0)

      # Reader decision based on stale metadata
      should_read_from_ets =
        LogOffset.compare(last_persisted_before, min_offset) == :lt and ets_ref != nil

      assert should_read_from_ets,
             "Reader with stale metadata would decide to read from ETS"

      # But ETS is empty!
      # The ETS table stores entries as {offset_tuple, json} pairs
      ets_read_result = :ets.tab2list(ets_ref)

      assert ets_read_result == [],
             "BUG: Reader gets empty results even though data exists (now on disk)"

      # Clean up
      PureFileStorage.terminate(writer_state(writer, writer_acc: flushed_acc))
    end

    @tag :race_condition_bug
    test "demonstrates that data IS on disk after flush but reader misses it", ctx do
      %{opts: opts} = ctx

      # Setup: write data and flush
      writer = PureFileStorage.init_writer!(opts, @shape)
      PureFileStorage.set_pg_snapshot(%{xmin: 100}, opts)
      PureFileStorage.mark_snapshot_as_started(opts)
      PureFileStorage.make_new_snapshot!([], opts)

      writer =
        PureFileStorage.append_to_log!(
          [{LogOffset.new(10, 0), "key1", :insert, ~S|{"id": "1"}|}],
          writer
        )

      # Flush to disk
      writer_state(writer_acc: acc) = writer
      flushed_acc = WriteLoop.flush_buffer(acc, writer)
      final_writer = writer_state(writer, writer_acc: flushed_acc)

      PureFileStorage.terminate(final_writer)

      # Now read - data SHOULD be there (on disk)
      result =
        PureFileStorage.get_log_stream(
          LogOffset.last_before_real_offsets(),
          LogOffset.last(),
          opts
        )
        |> Enum.to_list()

      assert result == [~S|{"id": "1"}|], "Data should be readable from disk after flush"
    end

    @tag :race_condition_fix
    test "proposed fix: re-check metadata before reading from ETS", ctx do
      %{opts: opts, stack_id: stack_id} = ctx

      writer = PureFileStorage.init_writer!(opts, @shape)
      PureFileStorage.set_pg_snapshot(%{xmin: 100}, opts)
      PureFileStorage.mark_snapshot_as_started(opts)
      PureFileStorage.make_new_snapshot!([], opts)

      writer =
        PureFileStorage.append_to_log!(
          [{LogOffset.new(10, 0), "key1", :insert, ~S|{"id": "1"}|}],
          writer
        )

      stack_ets = PureFileStorage.stack_ets(stack_id)

      # Reader captures stale metadata
      [storage_meta(
         ets_table: _ets_ref,
         last_persisted_offset: _stale_last_persisted
       )] = :ets.lookup(stack_ets, @shape_handle)

      # Writer flushes
      writer_state(writer_acc: acc) = writer
      flushed_acc = WriteLoop.flush_buffer(acc, writer)

      min_offset = LogOffset.new(10, 0)

      # THE FIX: Before reading from ETS, re-check current metadata
      [storage_meta(last_persisted_offset: current_last_persisted)] =
        :ets.lookup(stack_ets, @shape_handle)

      # If lastPersisted has advanced past our minOffset, data is now on disk
      should_read_from_disk =
        LogOffset.compare(current_last_persisted, min_offset) != :lt

      # With the fix, we detect that data moved to disk and read from there
      assert should_read_from_disk,
             "Fix correctly detects data moved to disk"

      PureFileStorage.terminate(writer_state(writer, writer_acc: flushed_acc))
    end
  end

  describe "timing window analysis" do
    @tag :race_condition_bug
    test "shows the exact timing window where race can occur", ctx do
      %{opts: opts, stack_id: stack_id} = ctx

      writer = PureFileStorage.init_writer!(opts, @shape)
      PureFileStorage.set_pg_snapshot(%{xmin: 100}, opts)
      PureFileStorage.mark_snapshot_as_started(opts)
      PureFileStorage.make_new_snapshot!([], opts)

      # Write data
      writer =
        PureFileStorage.append_to_log!(
          [{LogOffset.new(10, 0), "key1", :insert, ~S|{"id": "1"}|}],
          writer
        )

      stack_ets = PureFileStorage.stack_ets(stack_id)

      # Timeline of events:
      timeline = []

      # T1: Reader reads metadata
      [storage_meta(
         ets_table: ets_ref,
         last_persisted_offset: t1_last_persisted,
         last_seen_txn_offset: t1_last_seen
       )] = :ets.lookup(stack_ets, @shape_handle)

      timeline = [{:t1_reader_reads_metadata, t1_last_persisted, t1_last_seen} | timeline]

      # T2: Writer flushes (clears ETS, updates metadata)
      writer_state(writer_acc: acc) = writer
      flushed_acc = WriteLoop.flush_buffer(acc, writer)

      [storage_meta(last_persisted_offset: t2_last_persisted)] =
        :ets.lookup(stack_ets, @shape_handle)

      timeline = [{:t2_writer_flushes, t2_last_persisted} | timeline]

      # T3: Reader tries to read from ETS using T1 metadata
      ets_is_empty = :ets.info(ets_ref, :size) == 0

      timeline = [{:t3_reader_reads_ets, ets_is_empty} | timeline]

      # Verify the race window
      timeline = Enum.reverse(timeline)

      assert Enum.at(timeline, 0) ==
               {:t1_reader_reads_metadata, LogOffset.last_before_real_offsets(),
                LogOffset.new(10, 0)}

      assert Enum.at(timeline, 1) == {:t2_writer_flushes, LogOffset.new(10, 0)}
      assert Enum.at(timeline, 2) == {:t3_reader_reads_ets, true}

      # The race: At T1, reader decides to read from ETS (because last_persisted < min_offset)
      # At T2, writer flushes and clears ETS
      # At T3, reader reads from ETS but gets nothing!

      PureFileStorage.terminate(writer_state(writer, writer_acc: flushed_acc))
    end
  end
end
