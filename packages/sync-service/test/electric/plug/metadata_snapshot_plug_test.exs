defmodule Electric.Plug.MetadataSnapshotPlugTest do
  @moduledoc """
  Tests for the MetadataSnapshotPlug that returns PostgreSQL snapshot metadata.
  """
  use ExUnit.Case, async: false

  import Support.ComponentSetup
  import Support.DbSetup
  import Plug.Test

  alias Electric.Plug.Router

  @moduletag :tmp_dir

  describe "/v1/metadata-snapshot" do
    setup [:with_unique_db]

    setup do
      %{publication_name: "electric_test_publication", slot_name: "electric_test_slot"}
    end

    setup :with_complete_stack

    setup(ctx) do
      :ok = Electric.StatusMonitor.wait_until_active(ctx.stack_id, timeout: 1000)
      %{opts: Router.init(build_router_opts(ctx))}
    end

    test "GET returns metadata snapshot of the source", %{opts: opts} do
      conn =
        conn("GET", "/v1/metadata-snapshot")
        |> Router.call(opts)

      assert %{status: 200} = conn

      metadata = Jason.decode!(conn.resp_body)

      assert is_integer(metadata["xmin"])
      assert metadata["xmin"] > 0

      assert is_integer(metadata["xmax"])
      assert metadata["xmax"] > 0

      assert metadata["xmin"] < metadata["xmax"]

      assert is_list(metadata["xip_list"])
      assert Enum.all?(metadata["xip_list"], &is_integer/1)

      assert is_binary(metadata["database_lsn"])
      assert String.to_integer(metadata["database_lsn"]) >= 0
    end

    test "GET returns appropriate headers", %{opts: opts} do
      conn =
        conn("GET", "/v1/metadata-snapshot")
        |> Router.call(opts)

      assert %{status: 200} = conn

      assert Plug.Conn.get_resp_header(conn, "content-type") == [
               "application/json; charset=utf-8"
             ]

      assert Plug.Conn.get_resp_header(conn, "cache-control") == [
               "no-cache, no-store, must-revalidate"
             ]
    end
  end

  describe "/v1/metadata-snapshot with authentication" do
    setup [:with_unique_db]

    setup do
      %{publication_name: "electric_test_publication", slot_name: "electric_test_slot"}
    end

    setup :with_complete_stack
    setup :secure_mode

    setup(ctx) do
      :ok = Electric.StatusMonitor.wait_until_active(ctx.stack_id, timeout: 1000)
      %{opts: Router.init(build_router_opts(ctx))}
    end

    test "GET without secret returns 401", %{opts: opts} do
      conn =
        conn("GET", "/v1/metadata-snapshot")
        |> Router.call(opts)

      assert %{status: 401} = conn
      assert Jason.decode!(conn.resp_body) == %{"message" => "Unauthorized - Invalid API secret"}
    end

    test "GET with valid secret returns 200", %{opts: opts, secret: secret} do
      conn =
        conn("GET", "/v1/metadata-snapshot?secret=#{secret}")
        |> Router.call(opts)

      assert %{status: 200} = conn

      metadata = Jason.decode!(conn.resp_body)
      assert Map.has_key?(metadata, "xmin")
      assert Map.has_key?(metadata, "xmax")
      assert Map.has_key?(metadata, "xip_list")
      assert Map.has_key?(metadata, "database_lsn")
    end

    test "GET with invalid secret returns 401", %{opts: opts} do
      conn =
        conn("GET", "/v1/metadata-snapshot?secret=wrong_secret")
        |> Router.call(opts)

      assert %{status: 401} = conn
    end
  end
end
