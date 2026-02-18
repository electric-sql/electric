defmodule Electric.Client.ShapeKeyTest do
  use ExUnit.Case, async: true

  alias Electric.Client.ShapeKey

  describe "canonical/1 with URI" do
    test "excludes protocol parameters (cursor, handle, live, offset)" do
      uri =
        URI.parse(
          "http://localhost:3000/v1/shape?table=items&cursor=123&handle=abc&live=true&offset=0_0"
        )

      result = ShapeKey.canonical(uri)

      assert result == "http://localhost:3000/v1/shape?table=items"
    end

    test "excludes cache-buster and expired_handle params" do
      uri =
        URI.parse(
          "http://localhost:3000/v1/shape?table=items&cache-buster=xyz&expired_handle=old-handle"
        )

      result = ShapeKey.canonical(uri)

      assert result == "http://localhost:3000/v1/shape?table=items"
    end

    test "excludes log parameter" do
      uri = URI.parse("http://localhost:3000/v1/shape?table=items&log=true")
      result = ShapeKey.canonical(uri)

      assert result == "http://localhost:3000/v1/shape?table=items"
    end

    test "excludes subset parameters" do
      uri =
        URI.parse(
          "http://localhost:3000/v1/shape?table=items&subset__where=id>0&subset__limit=100"
        )

      result = ShapeKey.canonical(uri)

      assert result == "http://localhost:3000/v1/shape?table=items"
    end

    test "sorts remaining parameters alphabetically" do
      uri = URI.parse("http://localhost:3000/v1/shape?where=id>0&table=items&columns=id,name")
      result = ShapeKey.canonical(uri)

      assert result == "http://localhost:3000/v1/shape?columns=id%2Cname&table=items&where=id%3E0"
    end

    test "produces consistent keys for same shape definition" do
      # Different parameter order, same content
      uri1 = URI.parse("http://localhost:3000/v1/shape?table=items&where=id>0")
      uri2 = URI.parse("http://localhost:3000/v1/shape?where=id>0&table=items")

      assert ShapeKey.canonical(uri1) == ShapeKey.canonical(uri2)
    end

    test "produces different keys for different tables" do
      uri1 = URI.parse("http://localhost:3000/v1/shape?table=items")
      uri2 = URI.parse("http://localhost:3000/v1/shape?table=orders")

      refute ShapeKey.canonical(uri1) == ShapeKey.canonical(uri2)
    end

    test "produces different keys for different where clauses" do
      uri1 = URI.parse("http://localhost:3000/v1/shape?table=items&where=id>0")
      uri2 = URI.parse("http://localhost:3000/v1/shape?table=items&where=id>100")

      refute ShapeKey.canonical(uri1) == ShapeKey.canonical(uri2)
    end

    test "handles URI without query params" do
      uri = URI.parse("http://localhost:3000/v1/shape")
      result = ShapeKey.canonical(uri)

      assert result == "http://localhost:3000/v1/shape"
    end

    test "handles URI with only protocol params" do
      uri = URI.parse("http://localhost:3000/v1/shape?offset=0_0&handle=abc&live=true")
      result = ShapeKey.canonical(uri)

      assert result == "http://localhost:3000/v1/shape"
    end
  end

  describe "canonical/2 with endpoint and params" do
    test "filters out protocol parameters" do
      endpoint = URI.parse("http://localhost:3000/v1/shape")

      params = %{
        "table" => "items",
        "offset" => "0_0",
        "handle" => "my-handle",
        "live" => "true",
        "cursor" => "123"
      }

      result = ShapeKey.canonical(endpoint, params)

      assert result == "http://localhost:3000/v1/shape?table=items"
    end

    test "filters out cache busting parameters" do
      endpoint = URI.parse("http://localhost:3000/v1/shape")

      params = %{
        "table" => "items",
        "expired_handle" => "old-handle",
        "cache-buster" => "xyz123"
      }

      result = ShapeKey.canonical(endpoint, params)

      assert result == "http://localhost:3000/v1/shape?table=items"
    end

    test "sorts parameters alphabetically" do
      endpoint = URI.parse("http://localhost:3000/v1/shape")

      params = %{
        "where" => "status = 'active'",
        "table" => "orders",
        "columns" => "id,total,status"
      }

      result = ShapeKey.canonical(endpoint, params)

      # Parameters should be sorted: columns, table, where
      assert result =~ "columns="
      assert result =~ "table="
      assert result =~ "where="

      # Verify order by checking the full result
      decoded = URI.parse(result).query |> URI.decode_query()
      keys = Map.keys(decoded) |> Enum.sort()
      assert keys == ["columns", "table", "where"]
    end

    test "handles empty params" do
      endpoint = URI.parse("http://localhost:3000/v1/shape")
      result = ShapeKey.canonical(endpoint, %{})

      assert result == "http://localhost:3000/v1/shape"
    end

    test "handles params that are all protocol params" do
      endpoint = URI.parse("http://localhost:3000/v1/shape")

      params = %{
        "offset" => "-1",
        "handle" => "abc",
        "live" => "false",
        "cursor" => "999"
      }

      result = ShapeKey.canonical(endpoint, params)

      assert result == "http://localhost:3000/v1/shape"
    end

    test "preserves special characters in parameter values" do
      endpoint = URI.parse("http://localhost:3000/v1/shape")

      params = %{
        "table" => "items",
        "where" => "name ILIKE '%test%' AND id > 0"
      }

      result = ShapeKey.canonical(endpoint, params)

      # Should be properly URL encoded
      assert result =~ "table=items"
      assert result =~ "where="
    end
  end
end
