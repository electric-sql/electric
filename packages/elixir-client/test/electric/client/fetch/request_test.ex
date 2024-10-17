defmodule Electric.Client.Fetch.RequestTest do
  use ExUnit.Case, async: true

  alias Electric.Client
  alias Electric.Client.Fetch.Request

  defp client!(opts \\ []) do
    Client.new!(Keyword.merge([base_url: "https://cloud.electric.com"], opts))
  end

  describe "url/1" do
    test "generates valid urls" do
      request =
        Client.request(client!(),
          offset: Client.Offset.new(1234, 1),
          shape_id: "my-shape",
          live: true,
          next_cursor: 123_948,
          shape: Client.shape("my_table")
        )

      url = Request.url(request)
      {:ok, uri} = URI.new(url)

      assert %{
               path: "/v1/shape/my_table",
               scheme: "https",
               host: "cloud.electric.com",
               query: query
             } = uri

      params = URI.decode_query(query)

      assert %{
               "cursor" => "123948",
               "live" => "true",
               "offset" => "1234_1",
               "shape_id" => "my-shape"
             } = params
    end

    test "includes any additional params in the url" do
      request =
        Client.request(client!(),
          offset: Client.Offset.new(1234, 1),
          shape_id: "my-shape",
          live: true,
          next_cursor: 123_948,
          shape: Client.shape("my_table"),
          params: %{"my_param" => "here"}
        )

      url = Request.url(request)

      {:ok, uri} = URI.new(url)

      params = URI.decode_query(uri.query) |> dbg

      assert %{"my_param" => "here"} = params
    end
  end
end
