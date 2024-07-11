defmodule Electric.Plug.ServeShapePlugTest do
  use ExUnit.Case, async: true
  import Plug.Conn

  alias Electric.Postgres.Lsn
  alias Electric.Plug.ServeShapePlug
  alias Electric.Shapes.Shape
  alias Electric.ShapeCache.MockStorage

  import Mox
  setup :verify_on_exit!
  @moduletag :capture_log

  @test_shape %Shape{root_table: {"public", "users"}}
  @test_shape_id "test-shape-id"
  @test_offset 100
  @registry Registry.ServeShapePlugTest

  defmodule Inspector do
    def load_table_info({"public", "users"}, _), do: [%{name: "id", type: "int8"}]
  end

  setup do
    start_link_supervised!({Registry, keys: :duplicate, name: @registry})
    :ok
  end

  def conn(method, params, "?" <> _ = query_string) do
    # Pass mock dependencies to the plug
    config = %{
      shape_cache: {Electric.ShapeCacheMock, []},
      storage: {MockStorage, []},
      inspector: {__MODULE__.Inspector, []},
      registry: @registry,
      long_poll_timeout: 20_000,
      max_age: 60,
      stale_age: 300
    }

    Plug.Test.conn(method, "/" <> query_string, params)
    |> assign(:config, config)
  end

  describe "ServeShapePlug" do
    test "returns 400 for invalid params" do
      conn =
        conn(:get, %{"root_table" => ".invalid_shape"}, "?offset=invalid")
        |> ServeShapePlug.call([])

      assert conn.status == 400

      assert Jason.decode!(conn.resp_body) == %{
               "offset" => ["must be integer"],
               "root_table" => ["table name does not match expected format"]
             }
    end

    test "returns 400 for missing shape_id when offset != -1" do
      conn =
        conn(:get, %{"root_table" => "public.users"}, "?offset=0")
        |> ServeShapePlug.call([])

      assert conn.status == 400

      assert Jason.decode!(conn.resp_body) == %{
               "shape_id" => ["can't be blank when offset != -1"]
             }
    end

    test "returns snapshot when offset is -1" do
      Electric.ShapeCacheMock
      |> expect(:get_or_create_shape_id, fn @test_shape, _opts ->
        {@test_shape_id, @test_offset}
      end)
      |> expect(:wait_for_snapshot, fn _, @test_shape_id -> :ready end)

      MockStorage
      |> expect(:get_snapshot, fn @test_shape_id, _opts -> {0, [%{key: "snapshot"}]} end)
      |> expect(:get_log_stream, fn @test_shape_id, 0, _, _opts -> [%{key: "log"}] end)

      conn =
        conn(:get, %{"root_table" => "public.users"}, "?offset=-1")
        |> ServeShapePlug.call([])

      assert conn.status == 200

      assert Jason.decode!(conn.resp_body) == [
               %{"key" => "snapshot"},
               %{"key" => "log"},
               %{"headers" => %{"control" => "up-to-date"}}
             ]

      assert Plug.Conn.get_resp_header(conn, "etag") == ["#{@test_shape_id}:-1:#{@test_offset}"]
      assert Plug.Conn.get_resp_header(conn, "x-electric-shape-id") == [@test_shape_id]
    end

    test "snapshot has correct cache control headers" do
      Electric.ShapeCacheMock
      |> expect(:get_or_create_shape_id, fn @test_shape, _opts ->
        {@test_shape_id, @test_offset}
      end)
      |> expect(:wait_for_snapshot, fn _, @test_shape_id -> :ready end)

      MockStorage
      |> expect(:get_snapshot, fn @test_shape_id, _opts -> {0, [%{key: "snapshot"}]} end)
      |> expect(:get_log_stream, fn @test_shape_id, 0, _, _opts -> [%{key: "log"}] end)

      max_age = 62
      stale_age = 312

      conn =
        conn(:get, %{"root_table" => "public.users"}, "?offset=-1")
        |> put_in_config(:max_age, max_age)
        |> put_in_config(:stale_age, stale_age)
        |> ServeShapePlug.call([])

      assert conn.status == 200

      assert Plug.Conn.get_resp_header(conn, "cache-control") == [
               "max-age=#{max_age}, stale-while-revalidate=#{stale_age}"
             ]
    end

    test "returns log when offset is >= 0" do
      expect(Electric.ShapeCacheMock, :get_or_create_shape_id, fn @test_shape, _opts ->
        {@test_shape_id, @test_offset}
      end)

      MockStorage
      |> expect(:get_log_stream, fn @test_shape_id, 50, _, _opts ->
        [%{key: "log1"}, %{key: "log2"}]
      end)
      |> expect(:has_log_entry?, fn @test_shape_id, 50, _ -> true end)

      conn =
        conn(:get, %{"root_table" => "public.users"}, "?offset=50&shape_id=#{@test_shape_id}")
        |> ServeShapePlug.call([])

      assert conn.status == 200

      assert Jason.decode!(conn.resp_body) == [
               %{"key" => "log1"},
               %{"key" => "log2"},
               %{"headers" => %{"control" => "up-to-date"}}
             ]

      assert Plug.Conn.get_resp_header(conn, "etag") == ["#{@test_shape_id}:50:#{@test_offset}"]
      assert Plug.Conn.get_resp_header(conn, "x-electric-shape-id") == [@test_shape_id]
    end

    test "returns 304 Not Modified when If-None-Match matches ETag" do
      expect(Electric.ShapeCacheMock, :get_or_create_shape_id, fn @test_shape, _opts ->
        {@test_shape_id, @test_offset}
      end)

      expect(MockStorage, :has_log_entry?, fn @test_shape_id, 50, _ -> true end)

      conn =
        conn(:get, %{"root_table" => "public.users"}, "?offset=50&shape_id=#{@test_shape_id}")
        |> put_req_header("if-none-match", ~s("#{@test_shape_id}:50:#{@test_offset}"))
        |> ServeShapePlug.call([])

      assert conn.status == 304
      assert conn.resp_body == ""
    end

    test "handles live updates" do
      expect(Electric.ShapeCacheMock, :get_or_create_shape_id, fn @test_shape, _opts ->
        {@test_shape_id, @test_offset}
      end)

      test_pid = self()

      MockStorage
      |> expect(:has_log_entry?, fn @test_shape_id, 50, _ -> true end)
      |> expect(:get_log_stream, fn @test_shape_id, 50, _, _opts ->
        send(test_pid, :got_log_stream)
        []
      end)
      |> expect(:get_log_stream, fn @test_shape_id, 50, _, _opts -> ["test result"] end)

      task =
        Task.async(fn ->
          conn(
            :get,
            %{"root_table" => "public.users"},
            "?offset=50&shape_id=#{@test_shape_id}&live=true"
          )
          |> ServeShapePlug.call([])
        end)

      # Raised timeout here because sometimes, rarely, the task takes a little while to reach this point
      assert_receive :got_log_stream, 300
      Process.sleep(50)

      # Simulate new changes arriving
      Registry.dispatch(@registry, @test_shape_id, fn [{pid, ref}] ->
        send(pid, {ref, :new_changes, Lsn.from_string("0/10")})
      end)

      # The conn process should exit after sending the response
      conn = Task.await(task)

      assert conn.status == 200

      assert Jason.decode!(conn.resp_body) == [
               "test result",
               %{"headers" => %{"control" => "up-to-date"}}
             ]

      assert Plug.Conn.get_resp_header(conn, "cache-control") == [
               "no-store, no-cache, must-revalidate, max-age=0"
             ]

      assert Plug.Conn.get_resp_header(conn, "pragma") == ["no-cache"]
      assert Plug.Conn.get_resp_header(conn, "expires") == ["0"]
    end

    test "handles shape rotation" do
      expect(Electric.ShapeCacheMock, :get_or_create_shape_id, fn @test_shape, _opts ->
        {@test_shape_id, @test_offset}
      end)

      test_pid = self()

      MockStorage
      |> expect(:get_log_stream, fn @test_shape_id, 50, _, _opts ->
        send(test_pid, :got_log_stream)
        []
      end)
      |> expect(:has_log_entry?, fn @test_shape_id, 50, _ -> true end)

      task =
        Task.async(fn ->
          conn(
            :get,
            %{"root_table" => "public.users"},
            "?offset=50&shape_id=#{@test_shape_id}&live=true"
          )
          |> ServeShapePlug.call([])
        end)

      # Raised timeout here because sometimes, rarely, the task takes a little while to reach this point
      assert_receive :got_log_stream, 300
      Process.sleep(50)

      # Simulate shape rotation
      Registry.dispatch(@registry, @test_shape_id, fn [{pid, ref}] ->
        send(pid, {ref, :shape_rotation})
      end)

      conn = Task.await(task)

      # The conn process should exit after sending the response
      refute Process.alive?(conn.owner)

      assert conn.status == 200
      assert Jason.decode!(conn.resp_body) == [%{"headers" => %{"control" => "up-to-date"}}]
    end

    test "sends an up-to-date response after a timeout if no changes are observed" do
      expect(Electric.ShapeCacheMock, :get_or_create_shape_id, fn @test_shape, _opts ->
        {@test_shape_id, @test_offset}
      end)

      MockStorage
      |> expect(:get_log_stream, fn @test_shape_id, 50, _, _opts -> [] end)
      |> expect(:has_log_entry?, fn @test_shape_id, 50, _ -> true end)

      conn =
        conn(
          :get,
          %{"root_table" => "public.users"},
          "?offset=50&shape_id=#{@test_shape_id}&live=true"
        )
        |> put_in_config(:long_poll_timeout, 100)
        |> ServeShapePlug.call([])

      assert conn.status == 204

      assert Jason.decode!(conn.resp_body) == [%{"headers" => %{"control" => "up-to-date"}}]

      assert Plug.Conn.get_resp_header(conn, "cache-control") == [
               "no-store, no-cache, must-revalidate, max-age=0"
             ]

      assert Plug.Conn.get_resp_header(conn, "pragma") == ["no-cache"]
      assert Plug.Conn.get_resp_header(conn, "expires") == ["0"]
    end

    test "send 409 when shape offset is not known" do
      expect(Electric.ShapeCacheMock, :get_or_create_shape_id, fn @test_shape, _opts ->
        {@test_shape_id, @test_offset}
      end)

      MockStorage
      |> expect(:has_log_entry?, fn @test_shape_id, 50, _ -> false end)

      conn =
        conn(:get, %{"root_table" => "public.users"}, "?offset=50&shape_id=#{@test_shape_id}")
        |> ServeShapePlug.call([])

      assert conn.status == 409

      assert Jason.decode!(conn.resp_body) == %{
               "message" =>
                 "The shape associated with this shape_id and offset was not found. Resync to fetch the latest shape",
               "shape_id" => @test_shape_id,
               "offset" => -1
             }

      assert get_resp_header(conn, "location") == ["/?shape_id=#{@test_shape_id}&offset=-1"]
    end

    test "send 409 when shape ID requested does not exist" do
      expect(Electric.ShapeCacheMock, :get_or_create_shape_id, fn @test_shape, _opts ->
        {@test_shape_id, @test_offset}
      end)

      MockStorage
      |> expect(:has_log_entry?, fn "foo", _, _ -> false end)

      conn =
        conn(:get, %{"root_table" => "public.users"}, "?offset=50&shape_id=foo")
        |> ServeShapePlug.call([])

      assert conn.status == 409

      assert Jason.decode!(conn.resp_body) == %{
               "message" =>
                 "The shape associated with this shape_id and offset was not found. Resync to fetch the latest shape",
               "shape_id" => @test_shape_id,
               "offset" => -1
             }

      assert get_resp_header(conn, "location") == ["/?shape_id=#{@test_shape_id}&offset=-1"]
    end
  end

  defp put_in_config(%Plug.Conn{assigns: assigns} = conn, key, value),
    do: %{conn | assigns: put_in(assigns, [:config, key], value)}
end
