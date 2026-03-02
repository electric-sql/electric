defmodule Electric.ClientTest do
  use ExUnit.Case, async: false

  import Support.DbSetup
  import Support.ClientHelpers

  alias Electric.Client
  alias Electric.Client.ShapeDefinition
  alias Electric.Client.Fetch
  alias Electric.Client.Message.{ChangeMessage, ControlMessage, ResumeMessage, Headers}

  @insert Headers.insert(handle: "my-shape")

  defp client_stream(ctx, opts) do
    Client.stream(ctx.client, ctx.shape, opts)
  end

  defp stream(ctx) do
    client_stream(ctx, [])
  end

  defp stream(ctx, opts) when is_list(opts) do
    client_stream(ctx, opts)
  end

  defp stream(ctx, limit) when is_integer(limit) do
    client_stream(ctx, []) |> Enum.take(limit)
  end

  defp stream(ctx, limit, opts) when is_integer(limit) and is_list(opts) do
    client_stream(ctx, opts) |> Enum.take(limit)
  end

  defp start_bypass(_ctx) do
    [bypass: Bypass.open()]
  end

  # Drains the stream by repeatedly calling next/1 until :halt is returned.
  # Returns the final stream struct so we can inspect internal state.
  defp drain_stream(stream) do
    alias Electric.Client.Stream

    case Stream.next(stream) do
      {:halt, stream} -> stream
      {_msgs, stream} -> drain_stream(stream)
    end
  end

  describe "new" do
    test ":base_url is used as the base of the endpoint" do
      endpoint = URI.new!("http://localhost:3000/v1/shape")

      {:ok, %Client{endpoint: ^endpoint}} =
        Client.new(base_url: "http://localhost:3000")

      endpoint = URI.new!("http://localhost:3000/proxy/v1/shape")

      {:ok, %Client{endpoint: ^endpoint}} =
        Client.new(base_url: "http://localhost:3000/proxy")

      endpoint = URI.new!("http://localhost:3000/some/random/path/v1/shape")

      {:ok, %Client{endpoint: ^endpoint}} =
        Client.new(base_url: "http://localhost:3000/some/random/path")
    end

    test ":base_url is used as the base of the endpoint and accepts a URI" do
      endpoint = URI.new!("http://localhost:3000/v1/shape")

      {:ok, %Client{endpoint: ^endpoint}} =
        Client.new(base_url: URI.new!("http://localhost:3000"))

      endpoint = URI.new!("http://localhost:3000/proxy/v1/shape")

      {:ok, %Client{endpoint: ^endpoint}} =
        Client.new(base_url: URI.new!("http://localhost:3000/proxy"))

      endpoint = URI.new!("http://localhost:3000/some/random/path/v1/shape")

      {:ok, %Client{endpoint: ^endpoint}} =
        Client.new(base_url: URI.new!("http://localhost:3000/some/random/path"))
    end

    test ":endpoint is used as-is" do
      endpoint = URI.new!("http://localhost:3000")

      {:ok, %Client{endpoint: ^endpoint}} =
        Client.new(endpoint: "http://localhost:3000")

      endpoint = URI.new!("http://localhost:3000/v1/shape")

      {:ok, %Client{endpoint: ^endpoint}} =
        Client.new(endpoint: "http://localhost:3000/v1/shape")

      endpoint = URI.new!("http://localhost:3000/some/random/path")

      {:ok, %Client{endpoint: ^endpoint}} =
        Client.new(endpoint: "http://localhost:3000/some/random/path")
    end

    test ":endpoint is used as-is and accepts a URI" do
      endpoint = URI.new!("http://localhost:3000")

      {:ok, %Client{endpoint: ^endpoint}} = Client.new(endpoint: endpoint)

      endpoint = URI.new!("http://localhost:3000/v1/shape")

      {:ok, %Client{endpoint: ^endpoint}} = Client.new(endpoint: endpoint)

      endpoint = URI.new!("http://localhost:3000/some/random/path")

      {:ok, %Client{endpoint: ^endpoint}} = Client.new(endpoint: endpoint)
    end

    test "returns an error if neither :base_url or :endpoint is given" do
      assert {:error, _} = Client.new([])
    end

    test "returns error if fetch opts are not valid for impl" do
      endpoint = URI.new!("http://localhost:3000/some/random/path")

      assert {:error, _} =
               Client.new(endpoint: endpoint, fetch: {Electric.Client.Fetch.HTTP, invalid: true})
    end
  end

  describe "stream/2" do
    setup :with_unique_table

    setup(ctx) do
      {:ok, client} =
        Client.new(
          base_url: Application.fetch_env!(:electric_client, :electric_url),
          fetch:
            {Fetch.HTTP,
             [
               request: [
                 retry_log_level: false,
                 max_retries: 3,
                 connect_options: [protocols: [:http1]]
               ]
             ]}
        )

      shape = ShapeDefinition.new!(ctx.tablename)

      on_exit(fn ->
        ExUnit.CaptureLog.capture_log(fn ->
          Client.delete_shape(client, shape)
        end)
      end)

      [client: client, shape: shape]
    end

    test "streams an empty shape", ctx do
      assert [%ControlMessage{control: :up_to_date}] = stream(ctx, 1)
    end

    test "generates a unique id for the stream", ctx do
      n = 100

      ids =
        for _ <- 1..n do
          %{id: id} = client_stream(ctx, [])
          id
        end

      assert length(Enum.uniq(ids)) == n
    end

    test "streams a non empty shape", ctx do
      %{tablename: table} = ctx

      {:ok, id1} = insert_item(ctx)
      {:ok, id2} = insert_item(ctx)
      {:ok, id3} = insert_item(ctx)

      # snapshot values
      msgs = stream(ctx, 4)

      assert [
               %ChangeMessage{
                 headers: %{operation: :insert, relation: ["public", ^table]},
                 value: %{"id" => ^id1}
               },
               %ChangeMessage{
                 headers: %{operation: :insert, relation: ["public", ^table]},
                 value: %{"id" => ^id2}
               },
               %ChangeMessage{
                 headers: %{operation: :insert, relation: ["public", ^table]},
                 value: %{"id" => ^id3}
               },
               up_to_date()
             ] = msgs

      # 1 timestamp for the snapshot, 1 for the up-to-date response
      assert length(Enum.uniq_by(msgs, & &1.request_timestamp)) == 2
    end

    test "accepts a table name as a shape", ctx do
      %{tablename: table} = ctx

      assert is_binary(table)

      {:ok, id1} = insert_item(ctx)
      {:ok, id2} = insert_item(ctx)
      {:ok, id3} = insert_item(ctx)

      # snapshot values
      assert [
               %ChangeMessage{
                 headers: %{operation: :insert, relation: ["public", ^table]},
                 value: %{"id" => ^id1}
               },
               %ChangeMessage{
                 headers: %{operation: :insert, relation: ["public", ^table]},
                 value: %{"id" => ^id2}
               },
               %ChangeMessage{
                 headers: %{operation: :insert, relation: ["public", ^table]},
                 value: %{"id" => ^id3}
               },
               up_to_date()
             ] = Client.stream(ctx.client, table) |> Enum.take(4)
    end

    test "streams live data changes", ctx do
      {:ok, id1} = insert_item(ctx)

      parent = self()
      stream = stream(ctx)

      {:ok, _task} =
        start_supervised(
          {Task,
           fn ->
             stream
             |> Stream.each(&send(parent, {:stream, 1, &1}))
             |> Stream.run()
           end},
          id: {:stream, 1}
        )

      {:ok, _task} =
        start_supervised(
          {Task,
           fn ->
             stream
             |> Stream.each(&send(parent, {:stream, 2, &1}))
             |> Stream.run()
           end},
          id: {:stream, 2}
        )

      assert_receive {:stream, 1, %ChangeMessage{value: %{"id" => ^id1}}}, 5000
      assert_receive {:stream, 1, up_to_date()}
      assert_receive {:stream, 2, %ChangeMessage{value: %{"id" => ^id1}}}, 5000
      assert_receive {:stream, 2, up_to_date()}
      refute_receive _

      {:ok, {id2, id3}} =
        with_transaction(ctx, fn ctx ->
          {:ok, id2} = insert_item(ctx)
          {:ok, id3} = insert_item(ctx)
          {id2, id3}
        end)

      assert_receive {:stream, 1, %ChangeMessage{value: %{"id" => ^id2}}}, 5000
      assert_receive {:stream, 1, %ChangeMessage{value: %{"id" => ^id3}}}, 5000
      assert_receive {:stream, 1, up_to_date()}

      assert_receive {:stream, 2, %ChangeMessage{value: %{"id" => ^id2}}}, 5000
      assert_receive {:stream, 2, %ChangeMessage{value: %{"id" => ^id3}}}, 5000
      assert_receive {:stream, 2, up_to_date()}
      refute_receive _
    end

    test "does not send old values for updates with replica default", ctx do
      {:ok, id1} = insert_item(ctx, title: "Changing item")
      parent = self()
      stream = stream(ctx)

      {:ok, _task} =
        start_supervised(
          {Task,
           fn ->
             stream
             |> Stream.each(&send(parent, {:stream, 1, &1}))
             |> Stream.run()
           end},
          id: {:stream, 1}
        )

      assert_receive {:stream, 1, %ChangeMessage{value: %{"id" => ^id1}}}, 5000
      assert_receive {:stream, 1, up_to_date()}
      refute_receive _

      :ok = update_item(ctx, id1, value: 999)

      assert_receive {:stream, 1,
                      %ChangeMessage{
                        value: %{"id" => ^id1, "value" => 999},
                        old_value: nil
                      }},
                     500

      assert_receive {:stream, 1, up_to_date()}
      refute_receive _
    end

    test "sends full rows with replica: :full", ctx do
      {:ok, id1} = insert_item(ctx, title: "Changing item")
      parent = self()
      stream = stream(ctx, replica: :full)

      {:ok, _task} =
        start_supervised(
          {Task,
           fn ->
             stream
             |> Stream.each(&send(parent, {:stream, 1, &1}))
             |> Stream.run()
           end},
          id: {:stream, 1}
        )

      assert_receive {:stream, 1, %ChangeMessage{value: %{"id" => ^id1}}}, 5000
      assert_receive {:stream, 1, up_to_date()}
      refute_receive _

      :ok = update_item(ctx, id1, value: 999)

      assert_receive {:stream, 1,
                      %ChangeMessage{
                        value: %{"id" => ^id1, "value" => 999, "title" => "Changing item"},
                        old_value: %{"value" => 0}
                      }},
                     500

      assert_receive {:stream, 1, up_to_date()}
      refute_receive _
    end

    test "accepts replica: full setting on shape definition", ctx do
      {:ok, shape} = Electric.Client.shape(ctx.tablename, replica: :full)
      {:ok, id1} = insert_item(ctx, title: "Changing item")
      stream = Client.stream(ctx.client, shape)

      parent = self()

      {:ok, _task} =
        start_supervised(
          {Task,
           fn ->
             stream
             |> Stream.each(&send(parent, {:stream, 1, &1}))
             |> Stream.run()
           end},
          id: {:stream, 1}
        )

      assert_receive {:stream, 1, %ChangeMessage{value: %{"id" => ^id1}}}, 5000
      assert_receive {:stream, 1, up_to_date()}

      :ok = update_item(ctx, id1, value: 999)

      assert_receive {:stream, 1,
                      %ChangeMessage{
                        value: %{"id" => ^id1, "value" => 999, "title" => "Changing item"},
                        old_value: %{"value" => 0}
                      }},
                     500

      assert_receive {:stream, 1, up_to_date()}
    end

    test "stream setting of replica overrides shape", ctx do
      # for backwards compatibility
      {:ok, shape} = Electric.Client.shape(ctx.tablename, replica: :default)
      {:ok, id1} = insert_item(ctx, title: "Changing item")
      stream = Client.stream(ctx.client, shape, replica: :full)

      parent = self()

      {:ok, _task} =
        start_supervised(
          {Task,
           fn ->
             stream
             |> Stream.each(&send(parent, {:stream, 1, &1}))
             |> Stream.run()
           end},
          id: {:stream, 1}
        )

      assert_receive {:stream, 1, %ChangeMessage{value: %{"id" => ^id1}}}, 5000
      assert_receive {:stream, 1, up_to_date()}

      :ok = update_item(ctx, id1, value: 999)

      assert_receive {:stream, 1,
                      %ChangeMessage{
                        value: %{"id" => ^id1, "value" => 999, "title" => "Changing item"},
                        old_value: %{"value" => 0}
                      }},
                     500

      assert_receive {:stream, 1, up_to_date()}
    end

    test "params are appended to all requests" do
      params = %{my_goal: "unknowable", my_reasons: "inscrutable"}

      expected_query_params =
        Map.new(params, fn {k, v} ->
          {to_string(k), v}
        end)

      bypass = Bypass.open()

      on_exit(fn ->
        Bypass.down(bypass)
      end)

      {:ok, %Client{params: ^params} = client} =
        Client.new(base_url: "http://localhost:#{bypass.port}", params: params)

      stream = Client.stream(client, "things", live: false)

      parent = self()

      Bypass.expect(
        bypass,
        fn %{
             query_params: query_params
           } = conn ->
          for {k, v} <- expected_query_params do
            assert query_params[k] == v
          end

          send(parent, {:request, query_params})

          bypass_resp(conn, "[]",
            shape_handle: "my-shape",
            last_offset: "1234_0",
            schema: Jason.encode!(%{"id" => %{type: "text"}, "value" => %{type: "text"}})
          )
        end
      )

      Task.start_link(fn ->
        stream |> Stream.take(1) |> Enum.to_list()
      end)

      receive do
        {:request, _query} ->
          :ok
      after
        500 ->
          # the asserts in the bypass handler just trigger a retry loop
          flunk("did not receive the expected query parameters")
      end
    end

    test "errors: :raise raises" do
      bypass = Bypass.open()

      on_exit(fn ->
        Bypass.down(bypass)
      end)

      {:ok, client} =
        Client.new(base_url: "http://localhost:#{bypass.port}")

      stream = Client.stream(client, "things", errors: :raise)

      Bypass.expect(
        bypass,
        fn conn ->
          bypass_resp(conn, ~s[{"message": "not right"}], status: 400)
        end
      )

      assert_raise Client.Error, fn ->
        Enum.to_list(stream)
      end
    end

    test "errors: :stream puts error responses in the enum" do
      bypass = Bypass.open()

      on_exit(fn ->
        Bypass.down(bypass)
      end)

      {:ok, client} =
        Client.new(base_url: "http://localhost:#{bypass.port}")

      stream = Client.stream(client, "things", errors: :stream)

      Bypass.expect(
        bypass,
        fn conn ->
          bypass_resp(conn, ~s[{"message": "not right"}], status: 400)
        end
      )

      assert [%Client.Error{message: %{"message" => "not right"}}] = Enum.to_list(stream)
    end
  end

  defmodule TestTable do
    use Ecto.Schema

    schema "test_table" do
      field(:name, :string)
      field(:amount, :integer)
      field(:price, :decimal, source: :cost)
    end

    def changeset(data \\ %__MODULE__{}, params) do
      Ecto.Changeset.cast(data, params, [:name, :amount, :price])
      |> Ecto.Changeset.validate_required([:name, :amount, :price])
      |> Ecto.Changeset.validate_number(:price, greater_than_or_equal_to: 10)
    end
  end

  describe "Ecto defined shapes" do
    setup do
      {:ok, client} =
        Client.new(base_url: "http://localhost:3000")

      %{client: client}
    end

    test "schema module", ctx do
      %{client: %{params: params}} = Client.stream(ctx.client, TestTable)
      assert %{"table" => "test_table", "columns" => "id,name,amount,cost"} = params
    end

    test "ecto query", ctx do
      import Ecto.Query

      query = from(t in TestTable, where: t.price > 10)

      %{client: %{params: params}} = Client.stream(ctx.client, query)

      assert %{
               "table" => "test_table",
               "where" => "(\"cost\" > 10)",
               "columns" => "id,name,amount,cost"
             } =
               params
    end

    test "changeset function", ctx do
      %{client: %{params: params}} =
        Client.stream(ctx.client, &TestTable.changeset/1)

      assert %{"table" => "test_table", "columns" => "id,name,amount,cost"} =
               params
    end

    test "changeset", ctx do
      changeset = TestTable.changeset(%{})

      %{client: %{params: params}} = Client.stream(ctx.client, changeset)

      assert %{"table" => "test_table", "columns" => "id,name,amount,cost"} =
               params
    end
  end

  defp bypass_client(ctx) do
    {:ok, client} =
      Client.new(
        base_url: "http://localhost:#{ctx.bypass.port}",
        fetch:
          {Fetch.HTTP,
           [
             request: [
               connect_options: [timeout: 100, protocols: [:http1]],
               retry_delay: fn _n -> 50 end,
               retry_log_level: false,
               max_retries: 10
             ]
           ]}
      )

    [client: client]
  end

  defp shape_definition(ctx) do
    table_name = Map.get(ctx, :table_name, "my_table")
    shape = ShapeDefinition.new!(table_name)
    [shape: shape, table_name: table_name]
  end

  defp put_optional_header(conn, _header, nil) do
    conn
  end

  defp put_optional_header(conn, header, value) do
    Plug.Conn.put_resp_header(conn, header, value)
  end

  defp bypass_resp(conn, body, opts) do
    status = Keyword.get(opts, :status, 200)

    # the quick-responding tests are less flaky with a small delay --
    # think this is an issue with bypass. for very fast responses
    # the Req.request() function occasionally fails to return
    # this sleep seems to solve that
    Process.sleep(5)

    conn
    |> Plug.Conn.put_resp_content_type("application/json")
    |> put_optional_header("electric-handle", opts[:shape_handle])
    |> put_optional_header("electric-offset", opts[:last_offset])
    |> put_optional_header("electric-schema", opts[:schema])
    |> put_optional_header("electric-cursor", opts[:cursor])
    |> Plug.Conn.resp(status, body)
  end

  defp assert_response_state(responses) do
    assert Agent.get(responses, & &1) |> Map.values() |> Enum.uniq() == [[]]
  end

  describe "response handling" do
    setup [:start_bypass, :bypass_client, :shape_definition]

    test "empty response is handled", ctx do
      body1 =
        Jason.encode!([
          %{
            "headers" => %{"operation" => "insert"},
            "offset" => "1_0",
            "value" => %{"id" => "1111"}
          },
          # just put this message in to test handling
          %{"headers" => %{"control" => "snapshot-end"}},
          %{"headers" => %{"control" => "up-to-date", "global_last_seen_lsn" => 9998}}
        ])

      body2 =
        Jason.encode!([
          %{
            "headers" => %{"operation" => "insert"},
            "offset" => "2_0",
            "value" => %{"id" => "2222"}
          },
          %{"headers" => %{"control" => "up-to-date", "global_last_seen_lsn" => 9999}}
        ])

      schema = Jason.encode!(%{"id" => %{type: "text"}})

      {:ok, responses} =
        start_supervised(
          {Agent,
           fn ->
             %{
               "-1" => [
                 &bypass_resp(&1, body1,
                   shape_handle: "my-shape",
                   last_offset: "1_0",
                   schema: schema
                 )
               ],
               "1_0" => [
                 &bypass_resp(&1, "",
                   shape_handle: "my-shape",
                   last_offset: "1_0"
                 ),
                 &bypass_resp(&1, body2,
                   shape_handle: "my-shape",
                   last_offset: "2_0"
                 )
               ]
             }
           end}
        )

      parent = self()

      Bypass.expect(ctx.bypass, fn
        %{request_path: "/v1/shape", query_params: %{"table" => "my_table", "offset" => offset}} =
            conn ->
          fun =
            Agent.get_and_update(responses, fn resps ->
              Map.get_and_update(resps, offset, fn [fun | rest] -> {fun, rest} end)
            end)

          send(parent, {:offset, offset})
          fun.(conn)
      end)

      assert [
               %ChangeMessage{
                 headers: @insert,
                 value: %{"id" => "1111"}
               },
               up_to_date(9998),
               %ChangeMessage{
                 headers: @insert,
                 value: %{"id" => "2222"}
               },
               up_to_date(9999)
             ] = stream(ctx, 4)

      assert_receive {:offset, "-1"}
      assert_receive {:offset, "1_0"}
      assert_receive {:offset, "1_0"}
    end

    test "live requests pass cursor parameter", ctx do
      body1 =
        Jason.encode!([
          %{
            "headers" => %{"operation" => "insert"},
            "offset" => "1_0",
            "value" => %{"id" => "1111"}
          },
          %{"headers" => %{"control" => "up-to-date", "global_last_seen_lsn" => 9998}}
        ])

      body2 =
        Jason.encode!([
          %{
            "headers" => %{"operation" => "insert"},
            "offset" => "2_0",
            "value" => %{"id" => "2222"}
          },
          %{"headers" => %{"control" => "up-to-date", "global_last_seen_lsn" => 9999}}
        ])

      schema = Jason.encode!(%{"id" => %{type: "text"}})

      {:ok, responses} =
        start_supervised(
          {Agent,
           fn ->
             %{
               "-1" => [
                 &bypass_resp(&1, body1,
                   shape_handle: "my-shape",
                   last_offset: "1_0",
                   cursor: "299292",
                   schema: schema
                 )
               ],
               "1_0" => [
                 fn %{query_params: %{"cursor" => "299292"}} = conn ->
                   bypass_resp(conn, body2,
                     shape_handle: "my-shape",
                     last_offset: "2_0"
                   )
                 end
               ]
             }
           end}
        )

      parent = self()

      Bypass.expect(ctx.bypass, fn
        %{request_path: "/v1/shape", query_params: %{"table" => "my_table", "offset" => offset}} =
            conn ->
          fun =
            Agent.get_and_update(responses, fn resps ->
              Map.get_and_update(resps, offset, fn [fun | rest] -> {fun, rest} end)
            end)

          send(parent, {:offset, offset})
          fun.(conn)
      end)

      assert [
               %ChangeMessage{
                 headers: @insert,
                 value: %{"id" => "1111"}
               },
               up_to_date(9998),
               %ChangeMessage{
                 headers: @insert,
                 value: %{"id" => "2222"}
               },
               up_to_date(9999)
             ] = stream(ctx, 4)
    end

    test "client is resilient to server errors", ctx do
      body1 = [
        %{
          "headers" => %{
            "operation" => "insert",
            "txids" => [1010],
            "op_position" => 0,
            "lsn" => "00101"
          },
          "value" => %{"id" => "1111"}
        },
        %{"headers" => %{"control" => "up-to-date", "global_last_seen_lsn" => 9998}}
      ]

      body2 = [
        %{
          "headers" => %{
            "operation" => "insert",
            "txids" => [1020],
            "op_position" => 1,
            "lsn" => "00102"
          },
          "value" => %{"id" => "2222"}
        },
        %{"headers" => %{"control" => "up-to-date", "global_last_seen_lsn" => 9999}}
      ]

      # see https://hexdocs.pm/req/Req.Steps.html#retry/1 for the list of
      # "safe" responses that will be retried
      retry_statuses = [408, 429, 500, 502, 503, 504, 530, 599]

      {:ok, responses} =
        start_supervised({Agent,
         fn ->
           %{
             {"-1", nil, false} => [
               &bypass_resp(&1, Jason.encode!(body1),
                 shape_handle: "my-shape",
                 last_offset: "1_0",
                 schema: Jason.encode!(%{"id" => %{type: "text"}})
               ),
               &bypass_resp(&1, Jason.encode!(body1),
                 shape_handle: "my-shape-2",
                 last_offset: "1_0",
                 schema: Jason.encode!(%{"id" => %{type: "text"}})
               )
             ],
             {"1_0", "my-shape", true} =>
               [
                 fn conn ->
                   # return 500 then momentarily stop accepting connections
                   Task.start_link(fn ->
                     Process.sleep(10)
                     Bypass.down(ctx.bypass)
                     Process.sleep(100)
                     Bypass.up(ctx.bypass)
                   end)

                   bypass_resp(conn, "[]", status: 500)
                 end
               ] ++
                 Enum.map(retry_statuses, fn status ->
                   &bypass_resp(&1, "[]", status: status)
                 end) ++
                 [
                   &bypass_resp(&1, Jason.encode!(body2),
                     shape_handle: "my-shape",
                     last_offset: "2_0"
                   )
                 ]
           }
         end})

      parent = self()

      Bypass.expect(ctx.bypass, fn
        %{
          request_path: "/v1/shape",
          query_params: %{"table" => "my_table", "offset" => offset} = query_params
        } = conn ->
          shape_handle = Map.get(query_params, "handle", nil)
          live = Map.get(query_params, "live", "false") == "true"

          fun =
            Agent.get_and_update(responses, fn resps ->
              Map.get_and_update(resps, {offset, shape_handle, live}, fn [fun | rest] ->
                {fun, rest}
              end)
            end)

          send(parent, {:offset, offset})
          fun.(conn)
      end)

      {:ok, client} =
        Client.new(
          base_url: "http://localhost:#{ctx.bypass.port}",
          fetch:
            {Fetch.HTTP,
             [
               is_transient_fun: &Fetch.HTTP.transient_response?(&1, retry_statuses),
               request: [
                 connect_options: [timeout: 100, protocols: [:http1]],
                 retry_delay: fn _n -> 50 end,
                 retry_log_level: false,
                 max_retries: 15
               ]
             ]}
        )

      assert [
               %ChangeMessage{
                 headers: %{operation: :insert, lsn: "00101", txids: [1010]},
                 value: %{"id" => "1111"}
               },
               up_to_date(9998),
               %ChangeMessage{
                 headers: %{operation: :insert, lsn: "00102", txids: [1020]},
                 value: %{"id" => "2222"}
               },
               up_to_date(9999)
             ] = Client.stream(client, ctx.shape, []) |> Enum.take(4)
    end

    test "redirects to another shape id when given a 409", ctx do
      body1 = [
        %{
          "headers" => %{"operation" => "insert"},
          "offset" => "1_0",
          "value" => %{"id" => "1111"}
        },
        %{"headers" => %{"control" => "up-to-date", "global_last_seen_lsn" => "1234"}}
      ]

      {:ok, responses} =
        start_supervised(
          {Agent,
           fn ->
             %{
               {"-1", nil} => [
                 &bypass_resp(&1, Jason.encode!(body1),
                   shape_handle: "my-shape",
                   last_offset: "1_0",
                   schema: Jason.encode!(%{"id" => %{type: "text"}})
                 )
               ],
               {"-1", "my-shape-2"} => [
                 &bypass_resp(&1, Jason.encode!(body1),
                   shape_handle: "my-shape-2",
                   last_offset: "1_0",
                   schema: Jason.encode!(%{"id" => %{type: "text"}})
                 )
               ],
               {"1_0", "my-shape"} => [
                 &bypass_resp(&1, Jason.encode!([%{"headers" => %{"control" => "must-refetch"}}]),
                   status: 409,
                   shape_handle: "my-shape-2"
                 )
               ]
             }
           end}
        )

      parent = self()

      Bypass.expect(ctx.bypass, fn
        %{
          request_path: "/v1/shape",
          query_params: %{"table" => "my_table", "offset" => offset} = query_params
        } = conn ->
          shape_handle = Map.get(query_params, "handle", nil)

          fun =
            Agent.get_and_update(responses, fn resps ->
              Map.get_and_update(resps, {offset, shape_handle}, fn [fun | rest] -> {fun, rest} end)
            end)

          send(parent, {:offset, offset})
          fun.(conn)
      end)

      headers = Headers.insert(handle: "my-shape-2")

      assert [
               %ChangeMessage{
                 headers: @insert,
                 value: %{"id" => "1111"}
               },
               up_to_date(1234),
               %ControlMessage{control: :must_refetch},
               %ChangeMessage{
                 headers: ^headers,
                 value: %{"id" => "1111"}
               },
               up_to_date(1234)
             ] = stream(ctx, 5)

      assert_receive {:offset, "-1"}
      assert_receive {:offset, "1_0"}
      assert_receive {:offset, "-1"}

      assert_response_state(responses)
    end

    test "raises if the server returns an unhandled 4xx status", ctx do
      Bypass.expect_once(ctx.bypass, fn conn ->
        bypass_resp(conn, "[]", status: 410)
      end)

      assert_raise(Client.Error, fn ->
        stream(ctx, 4)
      end)
    end

    test "raises if the backoff expires", ctx do
      Bypass.expect(ctx.bypass, fn conn ->
        bypass_resp(conn, "[]", status: 500)
      end)

      assert_raise(Client.Error, fn ->
        stream(ctx) |> Stream.run()
      end)
    end
  end

  defp bypass_response(ctx, responses, opts \\ []) do
    %{table_name: table_name} = ctx
    path = Keyword.get(opts, :path, "/v1/shape")
    parent = self()

    Bypass.expect(
      ctx.bypass,
      fn %{
           request_path: ^path,
           query_params: %{"table" => ^table_name, "offset" => offset} = query_params
         } = conn ->
        shape_handle = Map.get(query_params, "handle", nil)

        fun =
          Agent.get_and_update(responses, fn resps ->
            Map.get_and_update(resps, {offset, shape_handle}, fn [fun | rest] -> {fun, rest} end)
          end)

        send(parent, {:offset, offset})

        fun.(conn)
      end
    )
  end

  describe "partial streams" do
    setup [:start_bypass, :bypass_client, :shape_definition]

    test "live: false should halt when up-to-date", ctx do
      body1 = [
        %{
          "headers" => %{"operation" => "insert"},
          "offset" => "1_0",
          "value" => %{"id" => "1111"}
        }
      ]

      body2 = [
        %{
          "headers" => %{"operation" => "insert"},
          "offset" => "2_0",
          "value" => %{"id" => "2222"}
        },
        %{"headers" => %{"control" => "up-to-date", "global_last_seen_lsn" => 9999}}
      ]

      body3 = [
        %{
          "headers" => %{"operation" => "insert"},
          "offset" => "2_0",
          "value" => %{"id" => "2222"}
        },
        %{"headers" => %{"control" => "up-to-date", "global_last_seen_lsn" => 9999}}
      ]

      {:ok, responses} =
        start_supervised(
          {Agent,
           fn ->
             %{
               {"-1", nil} => [
                 &bypass_resp(&1, Jason.encode!(body1),
                   shape_handle: "my-shape",
                   last_offset: "1_0",
                   schema: Jason.encode!(%{"id" => %{type: "text"}})
                 )
               ],
               {"1_0", "my-shape"} => [
                 &bypass_resp(&1, Jason.encode!(body2),
                   shape_handle: "my-shape",
                   last_offset: "2_0"
                 )
               ],
               {"2_0", "my-shape"} => [
                 &bypass_resp(&1, Jason.encode!(body3),
                   shape_handle: "my-shape",
                   last_offset: "3_0"
                 )
               ]
             }
           end}
        )

      bypass_response(ctx, responses)

      events = stream(ctx, live: false) |> Enum.into([])

      assert [
               %ChangeMessage{
                 value: %{"id" => "1111"},
                 headers: %Headers{operation: :insert}
               },
               %ChangeMessage{
                 value: %{"id" => "2222"},
                 headers: %Headers{operation: :insert}
               },
               up_to_date(9999),
               %ResumeMessage{
                 shape_handle: "my-shape",
                 offset: "2_0",
                 schema: %{id: %{type: "text"}}
               }
             ] = events
    end

    test "be able to resume from a certain point", ctx do
      body3 = [
        %{
          "headers" => %{"operation" => "insert"},
          "offset" => "3_0",
          "value" => %{"id" => "3333"}
        }
      ]

      body4 = [
        %{
          "headers" => %{"operation" => "insert"},
          "offset" => "4_0",
          "value" => %{"id" => "4444"}
        },
        %{"headers" => %{"control" => "up-to-date", "global_last_seen_lsn" => 9999}}
      ]

      {:ok, responses} =
        start_supervised(
          {Agent,
           fn ->
             %{
               {"2_0", "my-shape"} => [
                 &bypass_resp(&1, Jason.encode!(body3),
                   shape_handle: "my-shape",
                   last_offset: "3_0"
                 )
               ],
               {"3_0", "my-shape"} => [
                 &bypass_resp(&1, Jason.encode!(body4),
                   shape_handle: "my-shape",
                   last_offset: "4_0"
                 )
               ]
             }
           end}
        )

      bypass_response(ctx, responses)

      resume = %ResumeMessage{
        shape_handle: "my-shape",
        offset: "2_0",
        schema: %{id: %{type: "text"}}
      }

      events = stream(ctx, 3, resume: resume)

      assert [
               %ChangeMessage{
                 value: %{"id" => "3333"},
                 headers: %Headers{operation: :insert}
               },
               %ChangeMessage{
                 value: %{"id" => "4444"},
                 headers: %Headers{operation: :insert}
               },
               up_to_date(9999)
             ] = events
    end
  end

  describe "custom endpoint" do
    setup [:start_bypass, :bypass_client]

    setup(ctx) do
      path = "/shapes/special"

      {:ok, client} =
        Client.new(
          endpoint: "http://localhost:#{ctx.bypass.port}#{path}",
          fetch:
            {Fetch.HTTP,
             [
               request: [
                 connect_options: [timeout: 100, protocols: [:http1]],
                 retry_delay: fn _n -> 50 end,
                 retry_log_level: false,
                 max_retries: 10
               ]
             ]}
        )

      [client: client, path: path]
    end

    test "can stream a shape without a client shape definition", ctx do
      body1 = [
        %{
          "headers" => %{"operation" => "insert"},
          "offset" => "1_0",
          "value" => %{"id" => "1111"}
        }
      ]

      body2 = [
        %{
          "headers" => %{"operation" => "insert"},
          "offset" => "2_0",
          "value" => %{"id" => "2222"}
        }
      ]

      body3 = [
        %{
          "headers" => %{"operation" => "insert"},
          "offset" => "3_0",
          "value" => %{"id" => "3333"}
        },
        %{"headers" => %{"control" => "up-to-date", "global_last_seen_lsn" => 9999}}
      ]

      {:ok, responses} =
        start_supervised(
          {Agent,
           fn ->
             %{
               {"-1", nil} => [
                 &bypass_resp(&1, Jason.encode!(body1),
                   shape_handle: "my-shape",
                   last_offset: "1_0",
                   schema: Jason.encode!(%{"id" => %{type: "text"}})
                 )
               ],
               {"1_0", "my-shape"} => [
                 &bypass_resp(&1, Jason.encode!(body2),
                   shape_handle: "my-shape",
                   last_offset: "2_0"
                 )
               ],
               {"2_0", "my-shape"} => [
                 &bypass_resp(&1, Jason.encode!(body3),
                   shape_handle: "my-shape",
                   last_offset: "3_0"
                 )
               ]
             }
           end}
        )

      bypass_response_endpoint(ctx, responses, path: ctx.path)

      # create a stream without a shape definition
      events = Client.stream(ctx.client, live: false) |> Enum.into([])

      assert [
               %ChangeMessage{
                 value: %{"id" => "1111"},
                 headers: %Headers{operation: :insert}
               },
               %ChangeMessage{
                 value: %{"id" => "2222"},
                 headers: %Headers{operation: :insert}
               },
               %ChangeMessage{
                 value: %{"id" => "3333"},
                 headers: %Headers{operation: :insert}
               },
               up_to_date(9999),
               %ResumeMessage{
                 shape_handle: "my-shape",
                 offset: "3_0",
                 schema: %{id: %{type: "text"}}
               }
             ] = events
    end

    test "can stream a shape from a url", ctx do
      body1 = [
        %{
          "headers" => %{"operation" => "insert"},
          "offset" => "1_0",
          "value" => %{"id" => "1111"}
        }
      ]

      body2 = [
        %{
          "headers" => %{"operation" => "insert"},
          "offset" => "2_0",
          "value" => %{"id" => "2222"}
        }
      ]

      body3 = [
        %{
          "headers" => %{"operation" => "insert"},
          "offset" => "3_0",
          "value" => %{"id" => "3333"}
        },
        %{"headers" => %{"control" => "up-to-date", "global_last_seen_lsn" => 9999}}
      ]

      {:ok, responses} =
        start_supervised(
          {Agent,
           fn ->
             %{
               {"-1", nil} => [
                 &bypass_resp(&1, Jason.encode!(body1),
                   shape_handle: "my-shape",
                   last_offset: "1_0",
                   schema: Jason.encode!(%{"id" => %{type: "text"}})
                 )
               ],
               {"1_0", "my-shape"} => [
                 &bypass_resp(&1, Jason.encode!(body2),
                   shape_handle: "my-shape",
                   last_offset: "2_0"
                 )
               ],
               {"2_0", "my-shape"} => [
                 &bypass_resp(&1, Jason.encode!(body3),
                   shape_handle: "my-shape",
                   last_offset: "3_0"
                 )
               ]
             }
           end}
        )

      bypass_response_endpoint(ctx, responses, path: ctx.path)

      # create a stream without a shape definition
      events =
        Client.stream("http://localhost:#{ctx.bypass.port}#{ctx.path}", live: false)
        |> Enum.into([])

      assert [
               %ChangeMessage{
                 value: %{"id" => "1111"},
                 headers: %Headers{operation: :insert}
               },
               %ChangeMessage{
                 value: %{"id" => "2222"},
                 headers: %Headers{operation: :insert}
               },
               %ChangeMessage{
                 value: %{"id" => "3333"},
                 headers: %Headers{operation: :insert}
               },
               up_to_date(9999),
               %ResumeMessage{
                 shape_handle: "my-shape",
                 offset: "3_0",
                 schema: %{id: %{type: "text"}}
               }
             ] = events
    end
  end

  describe "move-out handling" do
    setup [:start_bypass, :bypass_client, :shape_definition]

    test "tag index stays empty when messages have no tags", ctx do
      # When insert messages have no "tags" header, the tag index should remain empty.
      # This is important because we shouldn't track rows that don't participate in
      # move-out semantics.
      body1 =
        Jason.encode!([
          %{
            "key" => "row-1",
            "headers" => %{"operation" => "insert"},
            "offset" => "1_0",
            "value" => %{"id" => "1111"}
          },
          %{
            "key" => "row-2",
            "headers" => %{"operation" => "insert"},
            "offset" => "1_1",
            "value" => %{"id" => "2222"}
          },
          %{"headers" => %{"control" => "up-to-date", "global_last_seen_lsn" => 9999}}
        ])

      schema = Jason.encode!(%{"id" => %{type: "text"}})

      {:ok, responses} =
        start_supervised(
          {Agent,
           fn ->
             %{
               {"-1", nil} => [
                 &bypass_resp(&1, body1,
                   shape_handle: "my-shape",
                   last_offset: "1_1",
                   schema: schema
                 )
               ]
             }
           end}
        )

      bypass_response(ctx, responses)

      # Use live: false so the stream halts after up-to-date
      stream = Client.stream(ctx.client, ctx.shape, live: false)
      final_stream = drain_stream(stream)

      # The tag index should be empty since no messages had tags
      assert final_stream.poll_state.tag_to_keys == %{},
             "tag_to_keys should be empty when no tags present, got: #{inspect(final_stream.poll_state.tag_to_keys)}"

      assert final_stream.poll_state.key_data == %{},
             "key_data should be empty when no tags present, got: #{inspect(final_stream.poll_state.key_data)}"
    end

    test "receives move-out and generates synthetic deletes", ctx do
      body1 =
        Jason.encode!([
          %{
            "key" => "row-1",
            "headers" => %{"operation" => "insert", "tags" => ["tag-abc"]},
            "offset" => "1_0",
            "value" => %{"id" => "1111", "name" => "test"}
          },
          %{"headers" => %{"control" => "up-to-date", "global_last_seen_lsn" => 9998}}
        ])

      body2 =
        Jason.encode!([
          %{
            "headers" => %{
              "event" => "move-out",
              "patterns" => [%{"pos" => 0, "value" => "tag-abc"}]
            }
          },
          %{"headers" => %{"control" => "up-to-date", "global_last_seen_lsn" => 9999}}
        ])

      schema = Jason.encode!(%{"id" => %{type: "text"}, "name" => %{type: "text"}})

      {:ok, responses} =
        start_supervised(
          {Agent,
           fn ->
             %{
               {"-1", nil} => [
                 &bypass_resp(&1, body1,
                   shape_handle: "my-shape",
                   last_offset: "1_0",
                   schema: schema
                 )
               ],
               {"1_0", "my-shape"} => [
                 &bypass_resp(&1, body2,
                   shape_handle: "my-shape",
                   last_offset: "2_0"
                 )
               ]
             }
           end}
        )

      bypass_response(ctx, responses)

      # Collect 4 messages: insert, up-to-date, synthetic delete, up-to-date
      msgs = stream(ctx, 4)

      assert [
               %ChangeMessage{headers: %{operation: :insert}, value: %{"id" => "1111"}},
               up_to_date(9998),
               %ChangeMessage{
                 headers: %{operation: :delete},
                 value: %{"id" => "1111", "name" => "test"}
               },
               up_to_date(9999)
             ] = msgs
    end

    test "move-out with multiple matching rows generates multiple deletes", ctx do
      body1 =
        Jason.encode!([
          %{
            "key" => "row-1",
            "headers" => %{"operation" => "insert", "tags" => ["shared-tag"]},
            "offset" => "1_0",
            "value" => %{"id" => "1111"}
          },
          %{
            "key" => "row-2",
            "headers" => %{"operation" => "insert", "tags" => ["shared-tag"]},
            "offset" => "1_1",
            "value" => %{"id" => "2222"}
          },
          %{"headers" => %{"control" => "up-to-date", "global_last_seen_lsn" => 9998}}
        ])

      body2 =
        Jason.encode!([
          %{
            "headers" => %{
              "event" => "move-out",
              "patterns" => [%{"pos" => 0, "value" => "shared-tag"}]
            }
          },
          %{"headers" => %{"control" => "up-to-date", "global_last_seen_lsn" => 9999}}
        ])

      schema = Jason.encode!(%{"id" => %{type: "text"}})

      {:ok, responses} =
        start_supervised(
          {Agent,
           fn ->
             %{
               {"-1", nil} => [
                 &bypass_resp(&1, body1,
                   shape_handle: "my-shape",
                   last_offset: "1_1",
                   schema: schema
                 )
               ],
               {"1_1", "my-shape"} => [
                 &bypass_resp(&1, body2,
                   shape_handle: "my-shape",
                   last_offset: "2_0"
                 )
               ]
             }
           end}
        )

      bypass_response(ctx, responses)

      # Collect messages: 2 inserts, up-to-date, 2 synthetic deletes, up-to-date
      msgs = stream(ctx, 6)

      insert_msgs = Enum.filter(msgs, &match?(%ChangeMessage{headers: %{operation: :insert}}, &1))
      delete_msgs = Enum.filter(msgs, &match?(%ChangeMessage{headers: %{operation: :delete}}, &1))

      assert length(insert_msgs) == 2
      assert length(delete_msgs) == 2

      delete_ids = Enum.map(delete_msgs, & &1.value["id"]) |> Enum.sort()
      assert delete_ids == ["1111", "2222"]
    end

    test "move-out with non-matching pattern is no-op", ctx do
      body1 =
        Jason.encode!([
          %{
            "key" => "row-1",
            "headers" => %{"operation" => "insert", "tags" => ["tag-A"]},
            "offset" => "1_0",
            "value" => %{"id" => "1111"}
          },
          %{"headers" => %{"control" => "up-to-date", "global_last_seen_lsn" => 9998}}
        ])

      body2 =
        Jason.encode!([
          %{
            "headers" => %{
              "event" => "move-out",
              "patterns" => [%{"pos" => 0, "value" => "tag-B"}]
            }
          },
          %{"headers" => %{"control" => "up-to-date", "global_last_seen_lsn" => 9999}}
        ])

      schema = Jason.encode!(%{"id" => %{type: "text"}})

      {:ok, responses} =
        start_supervised(
          {Agent,
           fn ->
             %{
               {"-1", nil} => [
                 &bypass_resp(&1, body1,
                   shape_handle: "my-shape",
                   last_offset: "1_0",
                   schema: schema
                 )
               ],
               {"1_0", "my-shape"} => [
                 &bypass_resp(&1, body2,
                   shape_handle: "my-shape",
                   last_offset: "2_0"
                 )
               ]
             }
           end}
        )

      bypass_response(ctx, responses)

      # Should only get: insert, up-to-date, up-to-date (no synthetic delete)
      msgs = stream(ctx, 3)

      delete_msgs = Enum.filter(msgs, &match?(%ChangeMessage{headers: %{operation: :delete}}, &1))
      assert delete_msgs == []

      assert [
               %ChangeMessage{headers: %{operation: :insert}},
               up_to_date(9998),
               up_to_date(9999)
             ] = msgs
    end

    test "tag index tracks updates with removed_tags", ctx do
      body1 =
        Jason.encode!([
          %{
            "key" => "row-1",
            "headers" => %{"operation" => "insert", "tags" => ["old-tag"]},
            "offset" => "1_0",
            "value" => %{"id" => "1111"}
          },
          %{"headers" => %{"control" => "up-to-date", "global_last_seen_lsn" => 9997}}
        ])

      body2 =
        Jason.encode!([
          %{
            "key" => "row-1",
            "headers" => %{
              "operation" => "update",
              "tags" => ["new-tag"],
              "removed_tags" => ["old-tag"]
            },
            "offset" => "2_0",
            "value" => %{"id" => "1111", "name" => "updated"}
          },
          %{"headers" => %{"control" => "up-to-date", "global_last_seen_lsn" => 9998}}
        ])

      body3 =
        Jason.encode!([
          %{
            "headers" => %{
              "event" => "move-out",
              "patterns" => [%{"pos" => 0, "value" => "old-tag"}]
            }
          },
          %{"headers" => %{"control" => "up-to-date", "global_last_seen_lsn" => 9999}}
        ])

      schema = Jason.encode!(%{"id" => %{type: "text"}, "name" => %{type: "text"}})

      {:ok, responses} =
        start_supervised(
          {Agent,
           fn ->
             %{
               {"-1", nil} => [
                 &bypass_resp(&1, body1,
                   shape_handle: "my-shape",
                   last_offset: "1_0",
                   schema: schema
                 )
               ],
               {"1_0", "my-shape"} => [
                 &bypass_resp(&1, body2,
                   shape_handle: "my-shape",
                   last_offset: "2_0"
                 )
               ],
               {"2_0", "my-shape"} => [
                 &bypass_resp(&1, body3,
                   shape_handle: "my-shape",
                   last_offset: "3_0"
                 )
               ]
             }
           end}
        )

      bypass_response(ctx, responses)

      # insert, up-to-date, update, up-to-date, up-to-date (no delete because row moved to new tag)
      msgs = stream(ctx, 5)

      delete_msgs = Enum.filter(msgs, &match?(%ChangeMessage{headers: %{operation: :delete}}, &1))
      assert delete_msgs == []
    end

    test "delete removes row from tag index", ctx do
      body1 =
        Jason.encode!([
          %{
            "key" => "row-1",
            "headers" => %{"operation" => "insert", "tags" => ["my-tag"]},
            "offset" => "1_0",
            "value" => %{"id" => "1111"}
          },
          %{"headers" => %{"control" => "up-to-date", "global_last_seen_lsn" => 9997}}
        ])

      body2 =
        Jason.encode!([
          %{
            "key" => "row-1",
            "headers" => %{"operation" => "delete", "tags" => ["my-tag"]},
            "offset" => "2_0",
            "value" => %{"id" => "1111"}
          },
          %{"headers" => %{"control" => "up-to-date", "global_last_seen_lsn" => 9998}}
        ])

      body3 =
        Jason.encode!([
          %{
            "headers" => %{
              "event" => "move-out",
              "patterns" => [%{"pos" => 0, "value" => "my-tag"}]
            }
          },
          %{"headers" => %{"control" => "up-to-date", "global_last_seen_lsn" => 9999}}
        ])

      schema = Jason.encode!(%{"id" => %{type: "text"}})

      {:ok, responses} =
        start_supervised(
          {Agent,
           fn ->
             %{
               {"-1", nil} => [
                 &bypass_resp(&1, body1,
                   shape_handle: "my-shape",
                   last_offset: "1_0",
                   schema: schema
                 )
               ],
               {"1_0", "my-shape"} => [
                 &bypass_resp(&1, body2,
                   shape_handle: "my-shape",
                   last_offset: "2_0"
                 )
               ],
               {"2_0", "my-shape"} => [
                 &bypass_resp(&1, body3,
                   shape_handle: "my-shape",
                   last_offset: "3_0"
                 )
               ]
             }
           end}
        )

      bypass_response(ctx, responses)

      # insert, up-to-date, delete, up-to-date, up-to-date (no synthetic delete)
      msgs = stream(ctx, 5)

      delete_msgs = Enum.filter(msgs, &match?(%ChangeMessage{headers: %{operation: :delete}}, &1))

      # Only 1 delete (the real one), not 2 (no synthetic delete after move-out)
      assert length(delete_msgs) == 1
      assert hd(delete_msgs).value["id"] == "1111"
    end

    test "update without removed_tags deduplicates synthetic deletes", ctx do
      # Edge case: when a row is updated with the same tag but no removed_tags,
      # the tag_index should deduplicate entries so only one synthetic delete is generated
      body1 =
        Jason.encode!([
          %{
            "key" => "row-1",
            "headers" => %{"operation" => "insert", "tags" => ["my-tag"]},
            "offset" => "1_0",
            "value" => %{"id" => "1111", "version" => "1"}
          },
          %{"headers" => %{"control" => "up-to-date", "global_last_seen_lsn" => 9997}}
        ])

      body2 =
        Jason.encode!([
          %{
            "key" => "row-1",
            "headers" => %{
              "operation" => "update",
              # Same tag, but no removed_tags - this is the problematic case
              "tags" => ["my-tag"]
            },
            "offset" => "2_0",
            "value" => %{"id" => "1111", "version" => "2"}
          },
          %{"headers" => %{"control" => "up-to-date", "global_last_seen_lsn" => 9998}}
        ])

      body3 =
        Jason.encode!([
          %{
            "headers" => %{
              "event" => "move-out",
              "patterns" => [%{"pos" => 0, "value" => "my-tag"}]
            }
          },
          %{"headers" => %{"control" => "up-to-date", "global_last_seen_lsn" => 9999}}
        ])

      schema = Jason.encode!(%{"id" => %{type: "text"}, "version" => %{type: "text"}})

      {:ok, responses} =
        start_supervised(
          {Agent,
           fn ->
             %{
               {"-1", nil} => [
                 &bypass_resp(&1, body1,
                   shape_handle: "my-shape",
                   last_offset: "1_0",
                   schema: schema
                 )
               ],
               {"1_0", "my-shape"} => [
                 &bypass_resp(&1, body2,
                   shape_handle: "my-shape",
                   last_offset: "2_0"
                 )
               ],
               {"2_0", "my-shape"} => [
                 &bypass_resp(&1, body3,
                   shape_handle: "my-shape",
                   last_offset: "3_0"
                 )
               ]
             }
           end}
        )

      bypass_response(ctx, responses)

      # insert, up-to-date, update, up-to-date, synthetic delete, up-to-date
      # Should generate only 1 synthetic delete (deduplicated by key)
      msgs = stream(ctx, 6)

      delete_msgs = Enum.filter(msgs, &match?(%ChangeMessage{headers: %{operation: :delete}}, &1))

      # Verifies deduplication: only 1 synthetic delete despite multiple tag_index entries
      assert length(delete_msgs) == 1,
             "Expected 1 synthetic delete but got #{length(delete_msgs)} - duplicate entries in tag_index"
    end

    test "row with multiple tags - partial move-out should not delete if other tags remain",
         ctx do
      # Edge case: row has multiple tags, move-out for one tag shouldn't delete
      # if the row still belongs to the shape via another tag
      body1 =
        Jason.encode!([
          %{
            "key" => "row-1",
            "headers" => %{"operation" => "insert", "tags" => ["tag-a", "tag-b"]},
            "offset" => "1_0",
            "value" => %{"id" => "1111"}
          },
          %{"headers" => %{"control" => "up-to-date", "global_last_seen_lsn" => 9998}}
        ])

      body2 =
        Jason.encode!([
          %{
            "headers" => %{
              "event" => "move-out",
              # Only moving out tag-a, row still has tag-b
              "patterns" => [%{"pos" => 0, "value" => "tag-a"}]
            }
          },
          %{"headers" => %{"control" => "up-to-date", "global_last_seen_lsn" => 9999}}
        ])

      schema = Jason.encode!(%{"id" => %{type: "text"}})

      {:ok, responses} =
        start_supervised(
          {Agent,
           fn ->
             %{
               {"-1", nil} => [
                 &bypass_resp(&1, body1,
                   shape_handle: "my-shape",
                   last_offset: "1_0",
                   schema: schema
                 )
               ],
               {"1_0", "my-shape"} => [
                 &bypass_resp(&1, body2,
                   shape_handle: "my-shape",
                   last_offset: "2_0"
                 )
               ]
             }
           end}
        )

      bypass_response(ctx, responses)

      # insert, up-to-date, up-to-date
      # BUG: Currently generates a synthetic delete even though row still has tag-b
      # EXPECTED: No synthetic delete since row still belongs via tag-b
      msgs = stream(ctx, 3)

      delete_msgs = Enum.filter(msgs, &match?(%ChangeMessage{headers: %{operation: :delete}}, &1))

      # This documents expected behavior - row should NOT be deleted
      # If this fails, it confirms the bug that partial move-out incorrectly deletes
      assert delete_msgs == [],
             "Row with multiple tags should not be deleted when only one tag is moved out"
    end

    test "synthetic delete uses latest value after update", ctx do
      # Edge case: synthetic delete should use the most recent value, not stale data
      body1 =
        Jason.encode!([
          %{
            "key" => "row-1",
            "headers" => %{"operation" => "insert", "tags" => ["my-tag"]},
            "offset" => "1_0",
            "value" => %{"id" => "1111", "name" => "original"}
          },
          %{"headers" => %{"control" => "up-to-date", "global_last_seen_lsn" => 9997}}
        ])

      body2 =
        Jason.encode!([
          %{
            "key" => "row-1",
            "headers" => %{
              "operation" => "update",
              "tags" => ["my-tag"],
              "removed_tags" => ["my-tag"]
            },
            "offset" => "2_0",
            "value" => %{"id" => "1111", "name" => "updated"}
          },
          %{"headers" => %{"control" => "up-to-date", "global_last_seen_lsn" => 9998}}
        ])

      body3 =
        Jason.encode!([
          %{
            "headers" => %{
              "event" => "move-out",
              "patterns" => [%{"pos" => 0, "value" => "my-tag"}]
            }
          },
          %{"headers" => %{"control" => "up-to-date", "global_last_seen_lsn" => 9999}}
        ])

      schema = Jason.encode!(%{"id" => %{type: "text"}, "name" => %{type: "text"}})

      {:ok, responses} =
        start_supervised(
          {Agent,
           fn ->
             %{
               {"-1", nil} => [
                 &bypass_resp(&1, body1,
                   shape_handle: "my-shape",
                   last_offset: "1_0",
                   schema: schema
                 )
               ],
               {"1_0", "my-shape"} => [
                 &bypass_resp(&1, body2,
                   shape_handle: "my-shape",
                   last_offset: "2_0"
                 )
               ],
               {"2_0", "my-shape"} => [
                 &bypass_resp(&1, body3,
                   shape_handle: "my-shape",
                   last_offset: "3_0"
                 )
               ]
             }
           end}
        )

      bypass_response(ctx, responses)

      msgs = stream(ctx, 6)

      delete_msgs = Enum.filter(msgs, &match?(%ChangeMessage{headers: %{operation: :delete}}, &1))

      assert length(delete_msgs) == 1
      [delete] = delete_msgs

      # Synthetic delete should have the latest value, not the original
      assert delete.value["name"] == "updated",
             "Synthetic delete should use latest value, got: #{inspect(delete.value)}"
    end

    test "multiple patterns matching same row generates single delete", ctx do
      # Edge case: move-out with multiple patterns that both match the same row
      body1 =
        Jason.encode!([
          %{
            "key" => "row-1",
            "headers" => %{"operation" => "insert", "tags" => ["tag-a", "tag-b"]},
            "offset" => "1_0",
            "value" => %{"id" => "1111"}
          },
          %{"headers" => %{"control" => "up-to-date", "global_last_seen_lsn" => 9998}}
        ])

      body2 =
        Jason.encode!([
          %{
            "headers" => %{
              "event" => "move-out",
              # Both patterns match the same row
              "patterns" => [
                %{"pos" => 0, "value" => "tag-a"},
                %{"pos" => 1, "value" => "tag-b"}
              ]
            }
          },
          %{"headers" => %{"control" => "up-to-date", "global_last_seen_lsn" => 9999}}
        ])

      schema = Jason.encode!(%{"id" => %{type: "text"}})

      {:ok, responses} =
        start_supervised(
          {Agent,
           fn ->
             %{
               {"-1", nil} => [
                 &bypass_resp(&1, body1,
                   shape_handle: "my-shape",
                   last_offset: "1_0",
                   schema: schema
                 )
               ],
               {"1_0", "my-shape"} => [
                 &bypass_resp(&1, body2,
                   shape_handle: "my-shape",
                   last_offset: "2_0"
                 )
               ]
             }
           end}
        )

      bypass_response(ctx, responses)

      # insert, up-to-date, synthetic delete, up-to-date
      msgs = stream(ctx, 4)

      delete_msgs = Enum.filter(msgs, &match?(%ChangeMessage{headers: %{operation: :delete}}, &1))

      # Should only generate 1 delete, not 2
      assert length(delete_msgs) == 1,
             "Multiple patterns matching same row should generate single delete, got #{length(delete_msgs)}"
    end

    test "update removing all tags should clear tag index so move-out is a no-op", ctx do
      # This test demonstrates the stale tag-index entry bug:
      # When a row is updated to remove ALL its tags (with removed_tags but no new tags),
      # the tag-index entry should be cleared. A subsequent move-out for the old tag
      # should NOT generate a synthetic delete since the row is no longer in the tag index.
      #
      # EXPECTED: move-out should be a no-op (0 deletes)
      # CURRENT BUG: move-out generates 1 synthetic delete because the tag-index
      # entry wasn't properly cleared when all tags were removed.

      body1 =
        Jason.encode!([
          %{
            "key" => "row-1",
            "headers" => %{"operation" => "insert", "tags" => ["tag-A"]},
            "offset" => "1_0",
            "value" => %{"id" => "1111"}
          },
          %{"headers" => %{"control" => "up-to-date", "global_last_seen_lsn" => 9997}}
        ])

      body2 =
        Jason.encode!([
          %{
            "key" => "row-1",
            "headers" => %{
              "operation" => "update",
              # Remove the old tag but add NO new tags
              "removed_tags" => ["tag-A"]
              # Note: no "tags" field, meaning this row now has zero tags
            },
            "offset" => "2_0",
            "value" => %{"id" => "1111", "name" => "updated"}
          },
          %{"headers" => %{"control" => "up-to-date", "global_last_seen_lsn" => 9998}}
        ])

      body3 =
        Jason.encode!([
          %{
            "headers" => %{
              "event" => "move-out",
              "patterns" => [%{"pos" => 0, "value" => "tag-A"}]
            }
          },
          %{"headers" => %{"control" => "up-to-date", "global_last_seen_lsn" => 9999}}
        ])

      schema = Jason.encode!(%{"id" => %{type: "text"}, "name" => %{type: "text"}})

      {:ok, responses} =
        start_supervised(
          {Agent,
           fn ->
             %{
               {"-1", nil} => [
                 &bypass_resp(&1, body1,
                   shape_handle: "my-shape",
                   last_offset: "1_0",
                   schema: schema
                 )
               ],
               {"1_0", "my-shape"} => [
                 &bypass_resp(&1, body2,
                   shape_handle: "my-shape",
                   last_offset: "2_0"
                 )
               ],
               {"2_0", "my-shape"} => [
                 &bypass_resp(&1, body3,
                   shape_handle: "my-shape",
                   last_offset: "3_0"
                 )
               ]
             }
           end}
        )

      bypass_response(ctx, responses)

      # Collect messages: insert, up-to-date, update, up-to-date, up-to-date (no delete expected)
      msgs = stream(ctx, 5)

      delete_msgs = Enum.filter(msgs, &match?(%ChangeMessage{headers: %{operation: :delete}}, &1))

      # The move-out should NOT generate a synthetic delete because:
      # 1. The row was originally inserted with "tag-A"
      # 2. The update removed "tag-A" (via removed_tags) and added NO new tags
      # 3. The tag-index should have been cleared for this row
      # 4. The move-out for "tag-A" should find no matching rows
      assert delete_msgs == [],
             "Move-out should be a no-op when all tags were removed from row, but got #{length(delete_msgs)} delete(s)"
    end

    test "resume preserves move-out state - move-out after resume generates synthetic delete",
         ctx do
      # When resuming a stream, the tag index state should be preserved so that
      # move-out events after resume can still generate synthetic deletes.
      body1 =
        Jason.encode!([
          %{
            "key" => "row-1",
            "headers" => %{"operation" => "insert", "tags" => ["my-tag"]},
            "offset" => "1_0",
            "value" => %{"id" => "1111"}
          },
          %{"headers" => %{"control" => "up-to-date", "global_last_seen_lsn" => 9998}}
        ])

      schema = Jason.encode!(%{"id" => %{type: "text"}})

      {:ok, responses} =
        start_supervised(
          {Agent,
           fn ->
             %{
               {"-1", nil} => [
                 &bypass_resp(&1, body1,
                   shape_handle: "my-shape",
                   last_offset: "1_0",
                   schema: schema
                 )
               ]
             }
           end}
        )

      bypass_response(ctx, responses)

      # First, stream with live: false to get a ResumeMessage
      msgs = stream(ctx, live: false) |> Enum.to_list()

      resume_msg = Enum.find(msgs, &match?(%ResumeMessage{}, &1))
      assert resume_msg != nil

      # Now set up for resumed stream with a move-out
      body2 =
        Jason.encode!([
          %{
            "headers" => %{
              "event" => "move-out",
              "patterns" => [%{"pos" => 0, "value" => "my-tag"}]
            }
          },
          %{"headers" => %{"control" => "up-to-date", "global_last_seen_lsn" => 9999}}
        ])

      {:ok, responses2} =
        start_supervised(
          {Agent,
           fn ->
             %{
               {"1_0", "my-shape"} => [
                 &bypass_resp(&1, body2,
                   shape_handle: "my-shape",
                   last_offset: "2_0"
                 )
               ]
             }
           end},
          id: :responses2
        )

      bypass_response(ctx, responses2)

      # Resume the stream - with proper move-out support, the tag index should be restored
      resumed_msgs = stream(ctx, resume: resume_msg, live: false) |> Enum.to_list()

      # The move-out SHOULD generate a synthetic delete for the row
      delete_msgs =
        Enum.filter(resumed_msgs, &match?(%ChangeMessage{headers: %{operation: :delete}}, &1))

      # After resume, move-out should still generate synthetic deletes
      assert length(delete_msgs) == 1,
             "After resume, move-out should generate synthetic delete, got: #{inspect(resumed_msgs)}"

      [delete] = delete_msgs
      assert delete.value["id"] == "1111"
    end
  end

  defp bypass_response_endpoint(ctx, responses, opts) do
    path = Keyword.get(opts, :path, "/v1/shape")
    parent = self()

    Bypass.expect(
      ctx.bypass,
      fn %{
           request_path: ^path,
           query_params: %{"offset" => offset} = query_params
         } = conn ->
        shape_handle = Map.get(query_params, "handle", nil)

        fun =
          Agent.get_and_update(responses, fn resps ->
            Map.get_and_update(resps, {offset, shape_handle}, fn [fun | rest] -> {fun, rest} end)
          end)

        send(parent, {:offset, offset})

        fun.(conn)
      end
    )
  end

  describe "cache busting" do
    setup [:start_bypass, :bypass_client, :shape_definition]

    setup ctx do
      # Clear the expired shapes cache before each test
      Electric.Client.ExpiredShapesCache.clear()
      ctx
    end

    test "409 response marks handle as expired in cache", ctx do
      alias Electric.Client.ShapeKey
      alias Electric.Client.ExpiredShapesCache

      # First request succeeds with handle "my-shape"
      body1 =
        Jason.encode!([
          %{
            "headers" => %{"operation" => "insert"},
            "offset" => "1_0",
            "value" => %{"id" => "1"}
          },
          %{"headers" => %{"control" => "up-to-date", "global_last_seen_lsn" => 9998}}
        ])

      # Second request returns 409 with new handle "my-shape-2"
      body409 = Jason.encode!([%{"headers" => %{"control" => "must-refetch"}}])

      # Third request succeeds with new handle
      body2 =
        Jason.encode!([
          %{
            "headers" => %{"operation" => "insert"},
            "offset" => "1_0",
            "value" => %{"id" => "2"}
          },
          %{"headers" => %{"control" => "up-to-date", "global_last_seen_lsn" => 9999}}
        ])

      schema = Jason.encode!(%{"id" => %{type: "text"}})

      {:ok, responses} =
        start_supervised(
          {Agent,
           fn ->
             %{
               {"-1", nil} => [
                 &bypass_resp(&1, body1,
                   shape_handle: "my-shape",
                   last_offset: "1_0",
                   schema: schema
                 )
               ],
               {"1_0", "my-shape"} => [
                 &bypass_resp(&1, body409, status: 409, shape_handle: "my-shape-2")
               ],
               {"-1", "my-shape-2"} => [
                 &bypass_resp(&1, body2,
                   shape_handle: "my-shape-2",
                   last_offset: "1_0",
                   schema: schema
                 )
               ]
             }
           end}
        )

      bypass_response(ctx, responses)

      # Stream enough messages to trigger the 409 and recovery
      _msgs = stream(ctx, 5)

      # Verify handle was marked as expired
      # Note: use the table param from the shape, which is what gets merged into the client
      shape_params = ShapeDefinition.params(ctx.shape)
      shape_key = ShapeKey.canonical(ctx.client.endpoint, shape_params)
      assert ExpiredShapesCache.get_expired_handle(shape_key) == "my-shape"
    end

    test "subsequent requests include expired_handle parameter after 409", ctx do
      alias Electric.Client.ShapeKey
      alias Electric.Client.ExpiredShapesCache

      parent = self()

      # Setup: mark a handle as expired using the same shape key that will be used
      shape_params = ShapeDefinition.params(ctx.shape)
      shape_key = ShapeKey.canonical(ctx.client.endpoint, shape_params)
      ExpiredShapesCache.mark_expired(shape_key, "old-expired-handle")

      body =
        Jason.encode!([
          %{"headers" => %{"control" => "up-to-date", "global_last_seen_lsn" => 9999}}
        ])

      schema = Jason.encode!(%{"id" => %{type: "text"}})

      Bypass.expect(ctx.bypass, fn conn ->
        # Verify expired_handle param is included
        send(parent, {:query_params, conn.query_params})
        bypass_resp(conn, body, shape_handle: "new-shape", last_offset: "1_0", schema: schema)
      end)

      stream(ctx, live: false) |> Enum.take(1)

      assert_receive {:query_params, params}
      assert params["expired_handle"] == "old-expired-handle"
    end

    test "stale response triggers retry with cache-buster parameter", ctx do
      alias Electric.Client.ShapeKey
      alias Electric.Client.ExpiredShapesCache

      parent = self()
      {:ok, request_count} = Agent.start_link(fn -> 0 end)

      # Mark handle as expired (simulating previous 409)
      shape_params = ShapeDefinition.params(ctx.shape)
      shape_key = ShapeKey.canonical(ctx.client.endpoint, shape_params)
      ExpiredShapesCache.mark_expired(shape_key, "stale-handle")

      schema = Jason.encode!(%{"id" => %{type: "text"}})

      body_fresh =
        Jason.encode!([
          %{"headers" => %{"control" => "up-to-date", "global_last_seen_lsn" => 9999}}
        ])

      Bypass.expect(ctx.bypass, fn conn ->
        count = Agent.get_and_update(request_count, fn c -> {c + 1, c + 1} end)
        send(parent, {:request, count, conn.query_params})

        if count == 1 do
          # First response: return the stale handle (CDN serving cached response)
          bypass_resp(conn, "[]",
            shape_handle: "stale-handle",
            last_offset: "1_0",
            schema: schema
          )
        else
          # Second response: return fresh handle
          bypass_resp(conn, body_fresh,
            shape_handle: "fresh-handle",
            last_offset: "1_0",
            schema: schema
          )
        end
      end)

      stream(ctx, 1)

      # First request should NOT have cache-buster
      assert_receive {:request, 1, params1}
      refute Map.has_key?(params1, "cache-buster")

      # Second request SHOULD have cache-buster (retry after stale detection)
      assert_receive {:request, 2, params2}
      assert Map.has_key?(params2, "cache-buster")
    end

    test "fails after max stale cache retries exceeded", ctx do
      alias Electric.Client.ShapeKey
      alias Electric.Client.ExpiredShapesCache

      # Mark handle as expired
      shape_params = ShapeDefinition.params(ctx.shape)
      shape_key = ShapeKey.canonical(ctx.client.endpoint, shape_params)
      ExpiredShapesCache.mark_expired(shape_key, "permanently-stale-handle")

      schema = Jason.encode!(%{"id" => %{type: "text"}})

      # Always return the stale handle (simulating broken CDN)
      Bypass.expect(ctx.bypass, fn conn ->
        bypass_resp(conn, "[]",
          shape_handle: "permanently-stale-handle",
          last_offset: "1_0",
          schema: schema
        )
      end)

      # Should raise error after 3 retries
      assert_raise Client.Error, ~r/stale cached responses/, fn ->
        stream(ctx) |> Enum.take(1)
      end
    end

    test "ignores stale response when client has valid local handle", ctx do
      alias Electric.Client.ShapeKey
      alias Electric.Client.ExpiredShapesCache

      body1 =
        Jason.encode!([
          %{
            "headers" => %{"operation" => "insert"},
            "offset" => "1_0",
            "value" => %{"id" => "1"}
          },
          %{"headers" => %{"control" => "up-to-date", "global_last_seen_lsn" => 9998}}
        ])

      body2 =
        Jason.encode!([
          %{
            "headers" => %{"operation" => "insert"},
            "offset" => "2_0",
            "value" => %{"id" => "2"}
          },
          %{"headers" => %{"control" => "up-to-date", "global_last_seen_lsn" => 9999}}
        ])

      schema = Jason.encode!(%{"id" => %{type: "text"}})

      # Mark a handle as expired BEFORE we start streaming
      shape_params = ShapeDefinition.params(ctx.shape)
      shape_key = ShapeKey.canonical(ctx.client.endpoint, shape_params)
      ExpiredShapesCache.mark_expired(shape_key, "stale-handle")

      {:ok, responses} =
        start_supervised({Agent,
         fn ->
           %{
             {"-1", nil} => [
               &bypass_resp(&1, body1,
                 shape_handle: "good-handle",
                 last_offset: "1_0",
                 schema: schema
               )
             ],
             {"1_0", "good-handle"} => [
               # CDN returns stale cached response with old handle
               &bypass_resp(&1, "[]", shape_handle: "stale-handle", last_offset: "1_0"),
               # Next request gets fresh response
               &bypass_resp(&1, body2, shape_handle: "good-handle", last_offset: "2_0")
             ]
           }
         end})

      bypass_response(ctx, responses)
      msgs = stream(ctx, 4)

      # Should get both inserts - stale response was ignored, not treated as error
      insert_msgs =
        Enum.filter(msgs, &match?(%ChangeMessage{headers: %{operation: :insert}}, &1))

      assert length(insert_msgs) == 2
    end

    test "does not mark handle as expired for normal success responses", ctx do
      alias Electric.Client.ShapeKey
      alias Electric.Client.ExpiredShapesCache

      body =
        Jason.encode!([
          %{
            "headers" => %{"operation" => "insert"},
            "offset" => "1_0",
            "value" => %{"id" => "1"}
          },
          %{"headers" => %{"control" => "up-to-date", "global_last_seen_lsn" => 9999}}
        ])

      schema = Jason.encode!(%{"id" => %{type: "text"}})

      {:ok, responses} =
        start_supervised(
          {Agent,
           fn ->
             %{
               {"-1", nil} => [
                 &bypass_resp(&1, body,
                   shape_handle: "my-shape",
                   last_offset: "1_0",
                   schema: schema
                 )
               ]
             }
           end}
        )

      bypass_response(ctx, responses)

      # Stream messages
      stream(ctx, live: false) |> Enum.to_list()

      # Verify no handle was marked as expired
      shape_params = ShapeDefinition.params(ctx.shape)
      shape_key = ShapeKey.canonical(ctx.client.endpoint, shape_params)
      assert ExpiredShapesCache.get_expired_handle(shape_key) == nil
    end
  end
end
