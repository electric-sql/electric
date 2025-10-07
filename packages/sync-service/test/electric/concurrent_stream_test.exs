defmodule Electric.ConcurrentStreamTest do
  use ExUnit.Case, async: true

  alias Electric.ConcurrentStream

  @item_count 10
  @end_marker_key @item_count + 1

  describe "stream_to_end/2" do
    setup %{test: test} do
      table = :ets.new(:"#{test}:ets", [:public, :named_table, :ordered_set])
      {:ok, %{table: table}}
    end

    test "returns complete stream from CubDB when it's being written to concurrently", %{
      table: table
    } do
      stream =
        ConcurrentStream.stream_to_end(
          excluded_start_key: 0,
          end_marker_key: @end_marker_key,
          stream_fun: fn excluded_start_key, included_end_key ->
            :ets.select(
              table,
              [
                {{:"$1", :"$2"},
                 [
                   {:andalso, {:>, :"$1", {:const, excluded_start_key}},
                    {:"=<", :"$1", {:const, included_end_key}}}
                 ], [{{:"$1", :"$2"}}]}
              ]
            )
          end
        )

      read_tasks =
        for _ <- 1..10 do
          Task.async(fn ->
            items = Enum.to_list(stream)

            assert Enum.count(items) == @item_count

            for i <- 1..@item_count do
              assert Enum.at(items, i - 1) == {i, "item_#{i}"}
            end
          end)
        end

      # Write the stream concurrently
      for i <- 1..@item_count do
        :ets.insert(table, [{i, "item_#{i}"}])

        # Sleep to give the read process time to run
        Process.sleep(1)
      end

      # Write the end marker to let the read process that the stream has ended
      :ets.insert(table, [{@end_marker_key, "ended"}])

      Task.await_many(read_tasks)
    end
  end
end
