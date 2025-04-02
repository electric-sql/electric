defmodule Electric.Client.Fetch.HTTPTest do
  use ExUnit.Case, async: true

  alias Electric.Client.Fetch

  describe "validate_opts/1" do
    test "pass valid headers" do
      assert {:ok, _opts} = Fetch.HTTP.validate_opts(headers: [{"this", "that"}])
      assert {:ok, _opts} = Fetch.HTTP.validate_opts(headers: %{"this" => "that"})
    end

    test "reject invalid headers" do
      assert {:error, _} = Fetch.HTTP.validate_opts(headers: "here")
    end

    test "pass valid timeout" do
      assert {:ok, _opts} = Fetch.HTTP.validate_opts(timeout: 123)
      assert {:ok, _opts} = Fetch.HTTP.validate_opts(timeout: :infinity)
    end

    test "reject invalid timeout" do
      assert {:error, _} = Fetch.HTTP.validate_opts(timeout: -123)
      assert {:error, _} = Fetch.HTTP.validate_opts(timeout: 0)
      assert {:error, _} = Fetch.HTTP.validate_opts(timeout: :something)
    end

    test "pass valid request opts" do
      assert {:ok, _opts} = Fetch.HTTP.validate_opts(request: [doesnt: "matter"])
    end

    test "reject invalid opts" do
      assert {:error, _} = Fetch.HTTP.validate_opts(request: :ouch)
    end
  end

  describe "build_request/2" do
    test "merges connect_options" do
      assert %Req.Request{options: options} =
               %Fetch.Request{
                 endpoint: URI.new!("http://localhost:3000/v1/shape"),
                 authenticated: true,
                 headers: %{"h1" => "v1", "h2" => "v2"}
               }
               |> Fetch.HTTP.build_request(
                 request: [
                   retry: true,
                   retry_log_level: false,
                   connect_options: [proxy: {"http", "123.123.123.123", 8080, []}]
                 ]
               )

      assert %{
               retry: true,
               retry_log_level: false,
               connect_options: [
                 protocols: [:http2, :http1],
                 proxy: {"http", "123.123.123.123", 8080, []}
               ]
             } = options
    end

    test "merges headers" do
      assert %Req.Request{headers: headers} =
               %Fetch.Request{
                 endpoint: URI.new!("http://localhost:3000/v1/shape"),
                 authenticated: true,
                 headers: %{"h1" => "v1", "h2" => "v2"}
               }
               |> Fetch.HTTP.build_request(
                 headers: [{"h1", "v1_2"}, {"h3", "v3"}, {"h4", "v4_1"}, {"h4", "v4_2"}]
               )

      assert %{
               "h1" => ["v1", "v1_2"],
               "h2" => ["v2"],
               "h3" => ["v3"],
               "h4" => ["v4_1", "v4_2"]
             } = headers
    end
  end
end
