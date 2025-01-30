defmodule Electric.ShapeCache.FileStorage.ActionFileTest do
  use ExUnit.Case, async: true
  alias Electric.ShapeCache.FileStorage.ActionFile
  # alias Electric.Replication.LogOffset
  # alias Electric.ShapeCache.FileStorage.LogFile

  @moduletag :tmp_dir

  describe "stream/1" do
    test "streams actions from file", %{tmp_dir: tmp_dir} do
      action_file_path = Path.join(tmp_dir, "action_file")

      # Write test data in the correct binary format
      actions = [
        # Keep action
        <<1::64, 1::64, ?k::8>>,
        # Skip action
        <<2::64, 1::64, ?s::8>>,
        # Compact action with one position
        <<3::64, 1::64, ?c::8, 1::16, 0::64, 10::64>>
      ]

      File.write!(action_file_path, Enum.join(actions))

      # Test streaming
      result = ActionFile.stream(action_file_path) |> Enum.to_list()
      assert length(result) == 3

      assert [
               {{1, 1}, :keep},
               {{2, 1}, :skip},
               {{3, 1}, {:compact, [{0, 10}]}}
             ] = result
    end
  end
end
