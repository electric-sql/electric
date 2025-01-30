defmodule Electric.ShapeCache.FileStorage.Compaction do
  alias Electric.LogItems
  alias Electric.Utils
  alias Electric.ShapeCache.LogChunker
  alias Electric.ShapeCache.FileStorage.LogFile
  alias Electric.ShapeCache.FileStorage.KeyIndex
  alias Electric.ShapeCache.FileStorage.ActionFile

  # Compaction and race conditions
  #
  # `FileStorage` has a pointer to the last compacted offset (and the compacted log file name)
  # which is updated atomically once the compaction is complete, so while it's ongoing, the
  # pointer is not updated.
  #
  # While the log is compacted in place, it's actually a merged copy that's being
  # compacted, not the original log. Original log is deleted after the compaction
  # is complete and the pointer is updated.
  #
  # Any concurrent reads of the log that's being replaced are also OK: the `File.rename`
  # on linux doesn't close the original file descriptor, so the reader will still see
  # the original file, and we don't reuse file names. Any readers mid-file of the
  # log that's being replaced but that read the chunk will continue from a correct chunk
  # of the new file due to offset ordering being preserved. They might observe some updates
  # more than once in a compacted form.

  @spec compact_in_place({String.t(), String.t(), String.t()}, non_neg_integer(), (any(), any() ->
                                                                                     any())) ::
          {String.t(), String.t(), String.t()}
  def compact_in_place(
        {log_file_path, chunk_index_path, key_index_path},
        chunk_size \\ LogChunker.default_chunk_size_threshold(),
        merge_fun \\ &LogItems.merge_updates/2
      ) do
    KeyIndex.sort(key_index_path)
    ActionFile.create_from_key_index(key_index_path, log_file_path <> ".actions")

    {new_log, new_chunk_index, new_key_index} =
      LogFile.apply_actions(log_file_path, log_file_path <> ".actions", chunk_size, merge_fun)

    File.rm!(log_file_path <> ".actions")
    File.rename!(new_log, log_file_path)
    File.rename!(new_chunk_index, chunk_index_path)
    File.rename!(new_key_index, key_index_path)

    {log_file_path, chunk_index_path, key_index_path}
  end

  def merge_and_compact(
        log1,
        log2,
        merged_log_path,
        chunk_size \\ LogChunker.default_chunk_size_threshold()
      ) do
    {log_file_path1, _, key_index_path1} = log1
    {log_file_path2, _, key_index_path2} = log2

    second_part_start = File.stat!(log_file_path1).size
    Utils.concat_files([log_file_path1, log_file_path2], merged_log_path)

    KeyIndex.merge_with_offset(
      key_index_path1,
      key_index_path2,
      merged_log_path <> ".key_index",
      second_part_start
    )

    compact_in_place(
      {merged_log_path, merged_log_path <> ".chunk_index", merged_log_path <> ".key_index"},
      chunk_size
    )
  end

  def rm_log({log, chunk_index, key_index}) do
    File.rm!(log)
    File.rm!(chunk_index)
    File.rm!(key_index)
  end
end
