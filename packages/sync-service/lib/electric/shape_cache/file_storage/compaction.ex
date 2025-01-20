defmodule Electric.ShapeCache.FileStorage.Compaction do
  alias Electric.LogItems
  alias Electric.Utils
  alias Electric.ShapeCache.LogChunker
  alias Electric.ShapeCache.FileStorage.LogFile
  alias Electric.ShapeCache.FileStorage.KeyIndex
  alias Electric.ShapeCache.FileStorage.ActionFile

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
