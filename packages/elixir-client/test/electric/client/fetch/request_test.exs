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
          shape_handle: "my-shape",
          live: true,
          next_cursor: 123_948,
          shape: Client.shape!("my_table")
        )

      url = Request.url(request)
      {:ok, uri} = URI.new(url)

      assert %{
               path: "/v1/shape",
               scheme: "https",
               host: "cloud.electric.com",
               query: query
             } = uri

      params = URI.decode_query(query)

      assert %{
               "table" => "my_table",
               "cursor" => "123948",
               "live" => "true",
               "offset" => "1234_1",
               "handle" => "my-shape"
             } = params
    end

    test "wraps table names in quotes" do
      request =
        Client.request(client!(),
          offset: Client.Offset.new(1234, 1),
          shape_handle: "my-shape",
          live: true,
          next_cursor: 123_948,
          shape: Client.shape!("my table", namespace: "Wobbly")
        )

      url = Request.url(request)
      {:ok, uri} = URI.new(url)

      assert %{query: query} = uri

      params = URI.decode_query(query)

      assert %{
               "table" => ~s["Wobbly"."my table"],
               "cursor" => "123948",
               "live" => "true",
               "offset" => "1234_1",
               "handle" => "my-shape"
             } = params
    end

    test "includes any additional params in the url" do
      request =
        Client.request(client!(),
          offset: Client.Offset.new(1234, 1),
          shape_handle: "my-shape",
          live: true,
          next_cursor: 123_948,
          shape: Client.shape!("my_table"),
          params: %{"my_param" => "here"}
        )

      url = Request.url(request)

      {:ok, uri} = URI.new(url)

      params = URI.decode_query(uri.query)

      assert %{"my_param" => "here"} = params
    end

    test "includes column list in parameters" do
      columns = ["id", "value", "description"]

      request =
        Client.request(client!(),
          offset: Client.Offset.new(1234, 1),
          shape_handle: "my-shape",
          live: true,
          next_cursor: 123_948,
          shape: Client.shape!("my_table", columns: columns)
        )

      url = Request.url(request)

      {:ok, uri} = URI.new(url)

      params = URI.decode_query(uri.query)

      column_list = Enum.join(columns, ",")
      assert %{"columns" => ^column_list} = params
    end

    test "includes client database_id in params" do
      database_id = "168d01dc-9e19-4887-99d9-7f5eba1ca434"

      request =
        Client.request(client!(database_id: database_id),
          offset: Client.Offset.new(1234, 1),
          shape_handle: "my-shape",
          live: true,
          next_cursor: 123_948,
          shape: Client.shape!("my_table")
        )

      url = Request.url(request)

      {:ok, uri} = URI.new(url)

      params = URI.decode_query(uri.query)

      assert %{"database_id" => ^database_id} = params
    end
  end
end
