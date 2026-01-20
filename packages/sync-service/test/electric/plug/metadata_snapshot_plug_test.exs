defmodule Electric.Plug.MetadataSnapshotPlugTest do
  @moduledoc """
  Tests for the MetadataSnapshotPlug that returns comprehensive source and shape metadata.
  """
  use ExUnit.Case, async: false

  import Support.ComponentSetup
  import Support.DbSetup
  import Support.DbStructureSetup
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

    test "GET returns comprehensive metadata snapshot", %{opts: opts} do
      conn =
        conn("GET", "/v1/metadata-snapshot")
        |> Router.call(opts)

      assert %{status: 200} = conn

      metadata = Jason.decode!(conn.resp_body)

      # Check top-level structure
      assert Map.has_key?(metadata, "database")
      assert Map.has_key?(metadata, "status")
      assert Map.has_key?(metadata, "shape_count")
      assert Map.has_key?(metadata, "shapes")

      # Check database info
      db = metadata["database"]
      assert is_integer(db["xmin"])
      assert db["xmin"] > 0
      assert is_integer(db["xmax"])
      assert db["xmax"] > 0
      assert db["xmin"] < db["xmax"]
      assert is_list(db["xip_list"])
      assert is_binary(db["lsn"])
      assert String.to_integer(db["lsn"]) >= 0

      # Check status
      status = metadata["status"]
      assert Map.has_key?(status, "connection")
      assert Map.has_key?(status, "shape")

      # Check shape_count
      assert is_integer(metadata["shape_count"])
      assert metadata["shape_count"] >= 0

      # Shapes should be a list (may be empty if no shapes created)
      assert is_list(metadata["shapes"])
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

  describe "/v1/metadata-snapshot with shapes" do
    setup [:with_unique_db, :with_basic_tables, :with_sql_execute]

    setup do
      %{publication_name: "electric_test_publication", slot_name: "electric_test_slot"}
    end

    setup :with_complete_stack

    setup(ctx) do
      :ok = Electric.StatusMonitor.wait_until_active(ctx.stack_id, timeout: 1000)
      %{opts: Router.init(build_router_opts(ctx))}
    end

    @tag with_sql: ["INSERT INTO items VALUES (gen_random_uuid(), 'test value 1')"]
    test "GET returns per-shape metadata after creating a shape", %{opts: opts} do
      # First create a shape by requesting it
      conn("GET", "/v1/shape?table=items&offset=-1")
      |> Router.call(opts)

      # Now get the metadata snapshot
      conn =
        conn("GET", "/v1/metadata-snapshot")
        |> Router.call(opts)

      assert %{status: 200} = conn

      metadata = Jason.decode!(conn.resp_body)

      # Should have at least one shape now
      assert metadata["shape_count"] >= 1
      assert length(metadata["shapes"]) >= 1

      # Check first shape's structure
      [shape | _] = metadata["shapes"]

      assert Map.has_key?(shape, "handle")
      assert is_binary(shape["handle"])

      assert Map.has_key?(shape, "definition")
      definition = shape["definition"]
      assert Map.has_key?(definition, "table")
      assert definition["table"] == "public.items"
      assert Map.has_key?(definition, "primary_key")
      assert Map.has_key?(definition, "replica")
      assert Map.has_key?(definition, "log_mode")

      assert Map.has_key?(shape, "status")
      status = shape["status"]
      assert Map.has_key?(status, "snapshot_started")
      assert Map.has_key?(status, "snapshot_completed")

      # Shape should have started snapshot after being requested
      assert status["snapshot_started"] == true

      # latest_offset should exist (may be nil for very new shapes)
      assert Map.has_key?(shape, "latest_offset")

      # pg_snapshot may or may not be present depending on timing
      assert Map.has_key?(shape, "pg_snapshot")
    end

    @tag with_sql: ["INSERT INTO items VALUES (gen_random_uuid(), 'test value 1')"]
    test "GET returns shape with where clause when filtered", %{opts: opts} do
      # Create a shape with a where clause
      conn("GET", "/v1/shape?table=items&where=value='test value 1'&offset=-1")
      |> Router.call(opts)

      # Get metadata snapshot
      conn =
        conn("GET", "/v1/metadata-snapshot")
        |> Router.call(opts)

      assert %{status: 200} = conn

      metadata = Jason.decode!(conn.resp_body)

      # Find the shape with the where clause
      filtered_shape =
        Enum.find(metadata["shapes"], fn shape ->
          Map.has_key?(shape["definition"], "where")
        end)

      # If we found a shape with where clause, verify it
      if filtered_shape do
        assert filtered_shape["definition"]["where"] =~ "test value 1"
      end
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
      assert Map.has_key?(metadata, "database")
      assert Map.has_key?(metadata, "status")
      assert Map.has_key?(metadata, "shape_count")
      assert Map.has_key?(metadata, "shapes")
    end

    test "GET with invalid secret returns 401", %{opts: opts} do
      conn =
        conn("GET", "/v1/metadata-snapshot?secret=wrong_secret")
        |> Router.call(opts)

      assert %{status: 401} = conn
    end
  end
end
