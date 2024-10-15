defmodule Electric.Client.Fetch.ResponseTest do
  use ExUnit.Case, async: true

  alias Electric.Client.Fetch

  test "parses headers correctly" do
    schema = %{id: %{type: "int8"}}

    headers = %{
      "electric-shape-id" => "1234987-2349827349",
      "electric-chunk-last-offset" => "29827_3",
      "electric-schema" => Jason.encode!(schema),
      "electric-next-cursor" => "2394829387"
    }

    # headers are normalised lists of values
    expected_headers = Map.new(headers, fn {k, v} -> {k, [v]} end)

    assert %{
             status: 200,
             headers: ^expected_headers,
             shape_id: "1234987-2349827349",
             last_offset: %Electric.Client.Offset{tx: 29827, op: 3},
             schema: ^schema,
             next_cursor: 2_394_829_387
           } = Fetch.Response.decode!(200, headers, [])
  end

  test "parses list headers correctly" do
    schema = %{id: %{type: "int8"}}

    headers = %{
      "electric-shape-id" => ["1234987-2349827349"],
      "electric-chunk-last-offset" => ["29827_3"],
      "electric-schema" => [Jason.encode!(schema)],
      "electric-next-cursor" => ["2394829387"]
    }

    assert %{
             status: 200,
             headers: ^headers,
             shape_id: "1234987-2349827349",
             last_offset: %Electric.Client.Offset{tx: 29827, op: 3},
             schema: ^schema,
             next_cursor: 2_394_829_387
           } = Fetch.Response.decode!(200, headers, [])
  end
end
