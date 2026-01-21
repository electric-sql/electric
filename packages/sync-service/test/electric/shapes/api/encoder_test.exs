defmodule Electric.Shapes.Api.EncoderTest do
  use ExUnit.Case, async: true

  alias Electric.Shapes.Api.Encoder

  describe "JSON.subset/1" do
    test "handles Postgrex row format with JSON strings" do
      # Postgrex returns rows as lists, e.g., [json_string]
      metadata = %{xmin: 1, xmax: 10, xip_list: [2, 3]}
      # Items are in Postgrex row format: [json_string]
      items = [[~s|{"id":"1","value":"test"}|], [~s|{"id":"2","value":"other"}|]]
      item_stream = Stream.map(items, & &1)

      result =
        Encoder.JSON.subset({metadata, item_stream}) |> Enum.to_list() |> IO.iodata_to_binary()

      assert result =~ ~s|"data": [{"id":"1","value":"test"},{"id":"2","value":"other"}]|
    end

    test "handles empty item stream" do
      metadata = %{xmin: 1, xmax: 10, xip_list: []}
      item_stream = Stream.map([], & &1)

      result =
        Encoder.JSON.subset({metadata, item_stream}) |> Enum.to_list() |> IO.iodata_to_binary()

      assert result =~ ~s|"data": []|
    end
  end

  describe "JSON.log/1" do
    test "handles pre-encoded JSON strings" do
      items = [~s|{"id":"1"}|, ~s|{"id":"2"}|]
      item_stream = Stream.map(items, & &1)

      result = Encoder.JSON.log(item_stream) |> Enum.to_list() |> IO.iodata_to_binary()

      assert result == ~s|[{"id":"1"},{"id":"2"}]|
    end

    test "handles items with nil values (raw terms)" do
      items = [%{"id" => "1", "value" => nil}]
      item_stream = Stream.map(items, & &1)

      result = Encoder.JSON.log(item_stream) |> Enum.to_list() |> IO.iodata_to_binary()

      assert result =~ ~s|"value":null|
    end
  end
end
