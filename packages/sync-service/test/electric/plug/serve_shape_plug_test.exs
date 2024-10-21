defmodule Electric.Plug.ServeShapePlugTest do
  use ExUnit.Case, async: true
  import Plug.Conn

  alias Electric.Postgres.Lsn
  alias Electric.Replication.LogOffset
  alias Electric.Plug.ServeShapePlug
  alias Electric.Shapes.Shape

  alias Support.Mock

  import Mox

  setup :verify_on_exit!

  @moduletag :capture_log

  @registry Registry.ServeShapePlugTest

  @test_shape %Shape{
    root_table: {"public", "users"},
    root_table_id: :erlang.phash2({"public", "users"}),
    table_info: %{
      {"public", "users"} => %{
        columns: [
          %{name: "id", type: "int8", type_id: {20, 1}, pk_position: 0, array_dimensions: 0},
          %{name: "value", type: "text", type_id: {28, 1}, pk_position: nil, array_dimensions: 0}
        ],
        pk: ["id"]
      }
    }
  }
  @test_shape_id "test-shape-id"
  @test_opts %{foo: "bar"}
  @before_all_offset LogOffset.before_all()
  @first_offset LogOffset.first()
  @test_offset LogOffset.new(Lsn.from_integer(100), 0)
  @start_offset_50 LogOffset.new(Lsn.from_integer(50), 0)

  def load_column_info({"public", "users"}, _),
    do: {:ok, @test_shape.table_info[{"public", "users"}][:columns]}

  def load_column_info(_, _),
    do: :table_not_found

  def load_relation(tbl, _),
    do: Support.StubInspector.load_relation(tbl, nil)

  setup do
    start_link_supervised!({Registry, keys: :duplicate, name: @registry})
    :ok
  end

  def conn(method, params, "?" <> _ = query_string) do
    # Pass mock dependencies to the plug
    config = %{
      shape_cache: {Mock.ShapeCache, []},
      storage: {Mock.Storage, []},
      inspector: {__MODULE__, []},
      registry: @registry,
      long_poll_timeout: 20_000,
      max_age: 60,
      stale_age: 300
    }

    Plug.Test.conn(method, "/" <> query_string, params)
    |> assign(:config, config)
  end

  describe "ServeShapePlug" do
    test "seconds_since_oct9th_2024_next_interval" do
      # Mock the conn struct with assigns
      # 20 seconds
      conn = %Plug.Conn{
        assigns: %{config: %{long_poll_timeout: 20000}},
        query_params: %{"cursor" => nil}
      }

      # Calculate the expected next interval
      now = DateTime.utc_now()
      oct9th2024 = DateTime.from_naive!(~N[2024-10-09 00:00:00], "Etc/UTC")
      diff_in_seconds = DateTime.diff(now, oct9th2024, :second)
      expected_interval = ceil(diff_in_seconds / 20) * 20

      # Assert that the function returns the expected value
      assert Electric.Plug.ServeShapePlug.TimeUtils.seconds_since_oct9th_2024_next_interval(conn) ==
               expected_interval
    end

    test "seconds_since_oct9th_2024_next_interval with different timeout" do
      # Mock the conn struct with a different timeout
      # 30 seconds
      conn = %Plug.Conn{
        assigns: %{config: %{long_poll_timeout: 30000}},
        query_params: %{"cursor" => nil}
      }

      # Calculate the expected next interval
      now = DateTime.utc_now()
      oct9th2024 = DateTime.from_naive!(~N[2024-10-09 00:00:00], "Etc/UTC")
      diff_in_seconds = DateTime.diff(now, oct9th2024, :second)
      expected_interval = ceil(diff_in_seconds / 30) * 30

      # Assert that the function returns the expected value
      assert Electric.Plug.ServeShapePlug.TimeUtils.seconds_since_oct9th_2024_next_interval(conn) ==
               expected_interval
    end

    test "seconds_since_oct9th_2024_next_interval with different timeout and cursor collision" do
      # Mock the conn struct with a different timeout (30 seconds)
      conn = %Plug.Conn{
        assigns: %{config: %{long_poll_timeout: 30000}},
        query_params: %{"cursor" => nil}
      }

      # Calculate the expected next interval
      now = DateTime.utc_now()
      oct9th2024 = DateTime.from_naive!(~N[2024-10-09 00:00:00], "Etc/UTC")
      diff_in_seconds = DateTime.diff(now, oct9th2024, :second)
      expected_interval = ceil(diff_in_seconds / 30) * 30

      # Simulate a cursor collision
      conn = %{conn | query_params: %{"cursor" => "#{expected_interval}"}}

      # Assert that the function returns a DIFFERENT value due to collision
      assert Electric.Plug.ServeShapePlug.TimeUtils.seconds_since_oct9th_2024_next_interval(conn) !=
               expected_interval
    end

    test "returns 400 for invalid params" do
      conn =
        conn(:get, %{"root_table" => ".invalid_shape"}, "?offset=invalid")
        |> ServeShapePlug.call([])

      assert conn.status == 400

      assert Jason.decode!(conn.resp_body) == %{
               "offset" => ["has invalid format"],
               "root_table" => [
                 "Invalid zero-length delimited identifier"
               ]
             }
    end

    test "returns 400 when table does not exist" do
      # this will pass table name validation
      # but will fail to find the table
      conn =
        conn(:get, %{"root_table" => "_val1d_schëmaΦ$.Φtàble"}, "?offset=-1")
        |> ServeShapePlug.call([])

      assert conn.status == 400

      assert Jason.decode!(conn.resp_body) == %{
               "root_table" => ["table not found"]
             }
    end

    test "returns 400 for missing shape_id when offset != -1" do
      conn =
        conn(:get, %{"root_table" => "public.users"}, "?offset=#{LogOffset.first()}")
        |> ServeShapePlug.call([])

      assert conn.status == 400

      assert Jason.decode!(conn.resp_body) == %{
               "shape_id" => ["can't be blank when offset != -1"]
             }
    end

    test "returns 400 for live request when offset == -1" do
      conn =
        conn(
          :get,
          %{"root_table" => "public.users"},
          "?offset=#{LogOffset.before_all()}&live=true"
        )
        |> ServeShapePlug.call([])

      assert conn.status == 400

      assert Jason.decode!(conn.resp_body) == %{
               "live" => ["can't be true when offset == -1"]
             }
    end

    test "returns snapshot when offset is -1" do
      Mock.ShapeCache
      |> expect(:get_or_create_shape_id, fn @test_shape, _opts ->
        {@test_shape_id, @test_offset}
      end)
      |> stub(:has_shape?, fn @test_shape_id, _opts -> true end)
      |> expect(:await_snapshot_start, fn @test_shape_id, _ -> :started end)

      next_offset = LogOffset.increment(@first_offset)

      Mock.Storage
      |> stub(:for_shape, fn @test_shape_id, _opts -> @test_opts end)
      |> expect(:get_chunk_end_log_offset, fn @before_all_offset, _ ->
        next_offset
      end)
      |> expect(:get_snapshot, fn @test_opts ->
        {@first_offset, [Jason.encode!(%{key: "snapshot"})]}
      end)
      |> expect(:get_log_stream, fn @first_offset, _, @test_opts ->
        [Jason.encode!(%{key: "log", value: "foo", headers: %{}, offset: next_offset})]
      end)

      conn =
        conn(:get, %{"root_table" => "public.users"}, "?offset=-1")
        |> ServeShapePlug.call([])

      assert conn.status == 200

      assert Jason.decode!(conn.resp_body) == [
               %{"key" => "snapshot"},
               %{
                 "key" => "log",
                 "value" => "foo",
                 "headers" => %{},
                 "offset" => "#{next_offset}"
               }
             ]

      assert Plug.Conn.get_resp_header(conn, "etag") == [
               "#{@test_shape_id}:-1:#{next_offset}"
             ]

      assert Plug.Conn.get_resp_header(conn, "electric-shape-id") == [@test_shape_id]
    end

    test "snapshot has correct cache control headers" do
      Mock.ShapeCache
      |> expect(:get_or_create_shape_id, fn @test_shape, _opts ->
        {@test_shape_id, @test_offset}
      end)
      |> stub(:has_shape?, fn @test_shape_id, _opts -> true end)
      |> expect(:await_snapshot_start, fn @test_shape_id, _ -> :started end)

      next_offset = LogOffset.increment(@first_offset)

      Mock.Storage
      |> stub(:for_shape, fn @test_shape_id, _opts -> @test_opts end)
      |> expect(:get_chunk_end_log_offset, fn @before_all_offset, _ ->
        next_offset
      end)
      |> expect(:get_snapshot, fn @test_opts ->
        {@first_offset, [Jason.encode!(%{key: "snapshot"})]}
      end)
      |> expect(:get_log_stream, fn @first_offset, _, @test_opts ->
        [Jason.encode!(%{key: "log", value: "foo", headers: %{}, offset: next_offset})]
      end)

      max_age = 62
      stale_age = 312

      conn =
        conn(:get, %{"root_table" => "public.users"}, "?offset=-1")
        |> put_in_config(:max_age, max_age)
        |> put_in_config(:stale_age, stale_age)
        |> ServeShapePlug.call([])

      assert conn.status == 200

      assert Plug.Conn.get_resp_header(conn, "cache-control") == [
               "public, max-age=604800, s-maxage=3600, stale-while-revalidate=2629746"
             ]
    end

    test "response has correct schema header" do
      Mock.ShapeCache
      |> expect(:get_or_create_shape_id, fn @test_shape, _opts ->
        {@test_shape_id, @test_offset}
      end)
      |> stub(:has_shape?, fn @test_shape_id, _opts -> true end)
      |> expect(:await_snapshot_start, fn @test_shape_id, _ -> :started end)

      next_offset = LogOffset.increment(@first_offset)

      Mock.Storage
      |> stub(:for_shape, fn @test_shape_id, _opts -> @test_opts end)
      |> expect(:get_chunk_end_log_offset, fn @before_all_offset, _ ->
        next_offset
      end)
      |> expect(:get_snapshot, fn @test_opts ->
        {@first_offset, [Jason.encode!(%{key: "snapshot"})]}
      end)
      |> expect(:get_log_stream, fn @first_offset, _, @test_opts ->
        [Jason.encode!(%{key: "log", value: "foo", headers: %{}, offset: next_offset})]
      end)

      conn =
        conn(:get, %{"root_table" => "public.users"}, "?offset=-1")
        |> ServeShapePlug.call([])

      assert Plug.Conn.get_resp_header(conn, "electric-schema") == [
               ~s|{"id":{"type":"int8","pk_index":0},"value":{"type":"text"}}|
             ]
    end

    test "returns log when offset is >= 0" do
      Mock.ShapeCache
      |> expect(:get_shape, fn @test_shape, _opts ->
        {@test_shape_id, @test_offset}
      end)
      |> stub(:has_shape?, fn @test_shape_id, _opts -> true end)

      next_offset = LogOffset.increment(@start_offset_50)
      next_next_offset = LogOffset.increment(next_offset)

      Mock.Storage
      |> stub(:for_shape, fn @test_shape_id, _opts -> @test_opts end)
      |> expect(:get_chunk_end_log_offset, fn @start_offset_50, _ ->
        next_next_offset
      end)
      |> expect(:get_log_stream, fn @start_offset_50, _, @test_opts ->
        [
          Jason.encode!(%{key: "log1", value: "foo", headers: %{}, offset: next_offset}),
          Jason.encode!(%{key: "log2", value: "bar", headers: %{}, offset: next_next_offset})
        ]
      end)

      conn =
        conn(
          :get,
          %{"root_table" => "public.users"},
          "?offset=#{@start_offset_50}&shape_id=#{@test_shape_id}"
        )
        |> ServeShapePlug.call([])

      assert conn.status == 200

      assert Jason.decode!(conn.resp_body) == [
               %{
                 "key" => "log1",
                 "value" => "foo",
                 "headers" => %{},
                 "offset" => "#{next_offset}"
               },
               %{
                 "key" => "log2",
                 "value" => "bar",
                 "headers" => %{},
                 "offset" => "#{next_next_offset}"
               }
             ]

      assert Plug.Conn.get_resp_header(conn, "etag") == [
               "#{@test_shape_id}:#{@start_offset_50}:#{next_next_offset}"
             ]

      assert Plug.Conn.get_resp_header(conn, "electric-shape-id") == [@test_shape_id]

      assert Plug.Conn.get_resp_header(conn, "electric-chunk-last-offset") == [
               "#{next_next_offset}"
             ]

      assert Plug.Conn.get_resp_header(conn, "electric-chunk-up-to-date") == []
    end

    test "returns 304 Not Modified when If-None-Match matches ETag" do
      Mock.ShapeCache
      |> expect(:get_shape, fn @test_shape, _opts ->
        {@test_shape_id, @test_offset}
      end)
      |> stub(:has_shape?, fn @test_shape_id, _opts -> true end)

      Mock.Storage
      |> stub(:for_shape, fn @test_shape_id, _opts -> @test_opts end)
      |> expect(:get_chunk_end_log_offset, fn @start_offset_50, _ ->
        @test_offset
      end)

      conn =
        conn(
          :get,
          %{"root_table" => "public.users"},
          "?offset=#{@start_offset_50}&shape_id=#{@test_shape_id}"
        )
        |> put_req_header(
          "if-none-match",
          ~s("#{@test_shape_id}:#{@start_offset_50}:#{@test_offset}")
        )
        |> ServeShapePlug.call([])

      assert conn.status == 304
      assert conn.resp_body == ""
    end

    test "handles live updates" do
      Mock.ShapeCache
      |> expect(:get_shape, fn @test_shape, _opts ->
        {@test_shape_id, @test_offset}
      end)
      |> stub(:has_shape?, fn @test_shape_id, _opts -> true end)

      test_pid = self()
      next_offset = LogOffset.increment(@test_offset)
      next_offset_str = "#{next_offset}"

      Mock.Storage
      |> stub(:for_shape, fn @test_shape_id, _opts -> @test_opts end)
      |> expect(:get_chunk_end_log_offset, fn @test_offset, _ ->
        nil
      end)
      |> expect(:get_log_stream, fn @test_offset, @test_offset, @test_opts ->
        send(test_pid, :got_log_stream)
        []
      end)
      |> expect(:get_log_stream, fn @test_offset, ^next_offset, @test_opts ->
        [Jason.encode!("test result")]
      end)

      task =
        Task.async(fn ->
          conn(
            :get,
            %{"root_table" => "public.users"},
            "?offset=#{@test_offset}&shape_id=#{@test_shape_id}&live=true"
          )
          |> ServeShapePlug.call([])
        end)

      # Raised timeout here because sometimes, rarely, the task takes a little while to reach this point
      assert_receive :got_log_stream, 300
      Process.sleep(50)

      # Simulate new changes arriving
      Registry.dispatch(@registry, @test_shape_id, fn [{pid, ref}] ->
        send(pid, {ref, :new_changes, next_offset})
      end)

      # The conn process should exit after sending the response
      conn = Task.await(task)

      assert conn.status == 200

      assert Jason.decode!(conn.resp_body) == [
               "test result",
               %{"headers" => %{"control" => "up-to-date"}}
             ]

      assert Plug.Conn.get_resp_header(conn, "cache-control") == [
               "public, max-age=5, stale-while-revalidate=5"
             ]

      assert Plug.Conn.get_resp_header(conn, "electric-chunk-last-offset") == [next_offset_str]
      assert Plug.Conn.get_resp_header(conn, "electric-chunk-up-to-date") == [""]
      assert Plug.Conn.get_resp_header(conn, "electric-schema") == []
    end

    test "handles shape rotation" do
      Mock.ShapeCache
      |> expect(:get_shape, fn @test_shape, _opts ->
        {@test_shape_id, @test_offset}
      end)
      |> stub(:has_shape?, fn @test_shape_id, _opts -> true end)

      test_pid = self()

      Mock.Storage
      |> stub(:for_shape, fn @test_shape_id, _opts -> @test_opts end)
      |> expect(:get_chunk_end_log_offset, fn @test_offset, _ ->
        nil
      end)
      |> expect(:get_log_stream, fn @test_offset, _, @test_opts ->
        send(test_pid, :got_log_stream)
        []
      end)

      task =
        Task.async(fn ->
          conn(
            :get,
            %{"root_table" => "public.users"},
            "?offset=#{@test_offset}&shape_id=#{@test_shape_id}&live=true"
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
      assert Plug.Conn.get_resp_header(conn, "electric-chunk-up-to-date") == [""]
    end

    test "sends an up-to-date response after a timeout if no changes are observed" do
      Mock.ShapeCache
      |> expect(:get_shape, fn @test_shape, _opts ->
        {@test_shape_id, @test_offset}
      end)
      |> stub(:has_shape?, fn @test_shape_id, _opts -> true end)

      Mock.Storage
      |> stub(:for_shape, fn @test_shape_id, _opts -> @test_opts end)
      |> expect(:get_chunk_end_log_offset, fn @test_offset, _ ->
        nil
      end)
      |> expect(:get_log_stream, fn @test_offset, _, @test_opts ->
        []
      end)

      conn =
        conn(
          :get,
          %{"root_table" => "public.users"},
          "?offset=#{@test_offset}&shape_id=#{@test_shape_id}&live=true"
        )
        |> put_in_config(:long_poll_timeout, 100)
        |> ServeShapePlug.call([])

      assert conn.status == 204

      assert Jason.decode!(conn.resp_body) == [%{"headers" => %{"control" => "up-to-date"}}]

      assert Plug.Conn.get_resp_header(conn, "cache-control") == [
               "public, max-age=5, stale-while-revalidate=5"
             ]

      assert Plug.Conn.get_resp_header(conn, "electric-chunk-up-to-date") == [""]
    end

    test "sends 409 with a redirect to existing shape when requested shape ID does not exist" do
      Mock.ShapeCache
      |> expect(:get_shape, fn @test_shape, _opts ->
        {@test_shape_id, @test_offset}
      end)
      |> stub(:has_shape?, fn "foo", _opts -> false end)

      Mock.Storage
      |> stub(:for_shape, fn "foo", opts -> {"foo", opts} end)

      conn =
        conn(
          :get,
          %{"root_table" => "public.users"},
          "?offset=#{"50_12"}&shape_id=foo"
        )
        |> ServeShapePlug.call([])

      assert conn.status == 409

      assert Jason.decode!(conn.resp_body) == [%{"headers" => %{"control" => "must-refetch"}}]
      assert get_resp_header(conn, "electric-shape-id") == [@test_shape_id]
      assert get_resp_header(conn, "location") == ["/?shape_id=#{@test_shape_id}&offset=-1"]
    end

    test "creates a new shape when shape ID does not exist and sends a 409 redirecting to the newly created shape" do
      new_shape_id = "new-shape-id"

      Mock.ShapeCache
      |> expect(:get_shape, fn @test_shape, _opts -> nil end)
      |> stub(:has_shape?, fn @test_shape_id, _opts -> false end)
      |> expect(:get_or_create_shape_id, fn @test_shape, _opts ->
        {new_shape_id, @test_offset}
      end)

      Mock.Storage
      |> stub(:for_shape, fn new_shape_id, opts -> {new_shape_id, opts} end)

      conn =
        conn(
          :get,
          %{"root_table" => "public.users"},
          "?offset=#{"50_12"}&shape_id=#{@test_shape_id}"
        )
        |> ServeShapePlug.call([])

      assert conn.status == 409

      assert Jason.decode!(conn.resp_body) == [%{"headers" => %{"control" => "must-refetch"}}]
      assert get_resp_header(conn, "electric-shape-id") == [new_shape_id]
      assert get_resp_header(conn, "location") == ["/?shape_id=#{new_shape_id}&offset=-1"]
    end

    test "sends 400 when shape ID does not match shape definition" do
      Mock.ShapeCache
      |> expect(:get_shape, fn @test_shape, _opts -> nil end)
      |> stub(:has_shape?, fn @test_shape_id, _opts -> true end)

      Mock.Storage
      |> stub(:for_shape, fn @test_shape_id, opts -> {@test_shape_id, opts} end)

      conn =
        conn(
          :get,
          %{"root_table" => "public.users"},
          "?offset=#{"50_12"}&shape_id=#{@test_shape_id}"
        )
        |> ServeShapePlug.call([])

      assert conn.status == 400
      assert Jason.decode!(conn.resp_body) == [%{"headers" => %{"control" => "must-refetch"}}]
    end

    test "sends 400 when omitting primary key columns in selection" do
      conn =
        conn(
          :get,
          %{"root_table" => "public.users", "columns" => "value"},
          "?offset=-1"
        )
        |> ServeShapePlug.call([])

      assert conn.status == 400

      assert Jason.decode!(conn.resp_body) == %{
               "columns" => ["Must include all primary key columns, missing: id"]
             }
    end

    test "sends 400 when selecting invalid columns" do
      conn =
        conn(
          :get,
          %{"root_table" => "public.users", "columns" => "id,invalid"},
          "?offset=-1"
        )
        |> ServeShapePlug.call([])

      assert conn.status == 400

      assert Jason.decode!(conn.resp_body) == %{
               "columns" => ["The following columns could not be found: invalid"]
             }
    end
  end

  defp put_in_config(%Plug.Conn{assigns: assigns} = conn, key, value),
    do: %{conn | assigns: put_in(assigns, [:config, key], value)}
end
