defmodule Electric.ClientTest do
  use ExUnit.Case, async: true

  import Support.DbSetup
  import Support.ClientHelpers

  alias Electric.Client
  alias Electric.Client.ShapeDefinition
  alias Electric.Client.Fetch
  alias Electric.Client.Message.{ChangeMessage, ControlMessage, ResumeMessage, Headers}

  @insert Headers.insert()

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

    test "returns an error if neither :base_url or :endpoint is given" do
      assert {:error, _} = Client.new([])
    end

    test "database_id is correctly assigned" do
      {:ok, %Client{database_id: "1234"}} =
        Client.new(base_url: "http://localhost:3000", database_id: "1234")
    end

    test "database_id is optional" do
      {:ok, %Client{database_id: nil}} =
        Client.new(base_url: "http://localhost:3000", database_id: nil)
    end
  end

  describe "stream/1" do
    setup :with_unique_table

    setup(ctx) do
      {:ok, client} =
        Client.new(
          base_url: Application.fetch_env!(:electric_client, :electric_url),
          fetch:
            {Fetch.HTTP,
             [
               request: [
                 retry_delay: fn _n -> 50 end,
                 retry_log_level: false,
                 max_retries: 3,
                 connect_options: [protocols: [:http1]]
               ]
             ]}
        )

      shape = ShapeDefinition.new!(ctx.tablename)

      on_exit(fn ->
        Client.delete_shape(client, shape)
      end)

      [client: client, shape: shape]
    end

    test "streams an empty shape", ctx do
      assert [%ControlMessage{control: :up_to_date, offset: offset0()}] = stream(ctx, 1)
    end

    test "streams a non empty shape", ctx do
      %{tablename: table} = ctx

      {:ok, id1} = insert_item(ctx)
      {:ok, id2} = insert_item(ctx)
      {:ok, id3} = insert_item(ctx)

      # snapshot values
      assert [
               %ChangeMessage{
                 headers: %{operation: :insert, relation: ["public", ^table]},
                 value: %{"id" => ^id1},
                 offset: %Electric.Client.Offset{tx: 0, op: 0}
               },
               %ChangeMessage{
                 headers: %{operation: :insert, relation: ["public", ^table]},
                 value: %{"id" => ^id2},
                 offset: %Electric.Client.Offset{tx: 0, op: 0}
               },
               %ChangeMessage{
                 headers: %{operation: :insert, relation: ["public", ^table]},
                 value: %{"id" => ^id3},
                 offset: %Electric.Client.Offset{tx: 0, op: 0}
               },
               up_to_date0()
             ] = stream(ctx, 4)
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
                 value: %{"id" => ^id1},
                 offset: %Electric.Client.Offset{tx: 0, op: 0}
               },
               %ChangeMessage{
                 headers: %{operation: :insert, relation: ["public", ^table]},
                 value: %{"id" => ^id2},
                 offset: %Electric.Client.Offset{tx: 0, op: 0}
               },
               %ChangeMessage{
                 headers: %{operation: :insert, relation: ["public", ^table]},
                 value: %{"id" => ^id3},
                 offset: %Electric.Client.Offset{tx: 0, op: 0}
               },
               up_to_date0()
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
      assert_receive {:stream, 1, up_to_date0()}
      assert_receive {:stream, 2, %ChangeMessage{value: %{"id" => ^id1}}}, 5000
      assert_receive {:stream, 2, up_to_date0()}

      {:ok, id2} = insert_item(ctx)
      {:ok, id3} = insert_item(ctx)

      assert_receive {:stream, 1, %ChangeMessage{value: %{"id" => ^id2}}}, 5000
      assert_receive {:stream, 1, %ChangeMessage{value: %{"id" => ^id3}}}, 5000
      assert_receive {:stream, 1, up_to_date()}

      assert_receive {:stream, 2, %ChangeMessage{value: %{"id" => ^id2}}}, 5000
      assert_receive {:stream, 2, %ChangeMessage{value: %{"id" => ^id3}}}, 5000
      assert_receive {:stream, 2, up_to_date()}
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
      assert_receive {:stream, 1, up_to_date0()}

      :ok = update_item(ctx, id1, value: 999)

      assert_receive {:stream, 1,
                      %ChangeMessage{
                        value: %{"id" => ^id1, "value" => 999, "title" => "Changing item"}
                      }},
                     500

      assert_receive {:stream, 1, up_to_date()}
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
    Process.sleep(2)

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
          %{"headers" => %{"control" => "up-to-date"}}
        ])

      body2 =
        Jason.encode!([
          %{
            "headers" => %{"operation" => "insert"},
            "offset" => "2_0",
            "value" => %{"id" => "2222"}
          },
          %{"headers" => %{"control" => "up-to-date"}}
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
                 offset: offset(1, 0),
                 value: %{"id" => "1111"}
               },
               up_to_date(1, 0),
               %ChangeMessage{
                 headers: @insert,
                 offset: offset(2, 0),
                 value: %{"id" => "2222"}
               },
               up_to_date(2, 0)
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
          %{"headers" => %{"control" => "up-to-date"}}
        ])

      body2 =
        Jason.encode!([
          %{
            "headers" => %{"operation" => "insert"},
            "offset" => "2_0",
            "value" => %{"id" => "2222"}
          },
          %{"headers" => %{"control" => "up-to-date"}}
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
                 offset: offset(1, 0),
                 value: %{"id" => "1111"}
               },
               up_to_date(1, 0),
               %ChangeMessage{
                 headers: @insert,
                 offset: offset(2, 0),
                 value: %{"id" => "2222"}
               },
               up_to_date(2, 0)
             ] = stream(ctx, 4)
    end

    test "client is resilient to server errors", ctx do
      body1 = [
        %{
          "headers" => %{"operation" => "insert"},
          "offset" => "1_0",
          "value" => %{"id" => "1111"}
        },
        %{"headers" => %{"control" => "up-to-date"}}
      ]

      body2 = [
        %{
          "headers" => %{"operation" => "insert"},
          "offset" => "2_0",
          "value" => %{"id" => "2222"}
        },
        %{"headers" => %{"control" => "up-to-date"}}
      ]

      # see https://hexdocs.pm/req/Req.Steps.html#retry/1 for the list of
      # "safe" responses that will be retried
      retry_statuses = [408, 429, 500, 502, 503, 504]

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

      assert [
               %ChangeMessage{
                 headers: @insert,
                 offset: offset(1, 0),
                 value: %{"id" => "1111"}
               },
               up_to_date(1, 0),
               %ChangeMessage{
                 headers: @insert,
                 offset: offset(2, 0),
                 value: %{"id" => "2222"}
               },
               up_to_date(2, 0)
             ] = stream(ctx, 4)
    end

    test "resets to an empty shape id when given a 400", ctx do
      body1 = [
        %{
          "headers" => %{"operation" => "insert"},
          "offset" => "1_0",
          "value" => %{"id" => "1111"}
        },
        %{"headers" => %{"control" => "up-to-date"}}
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
                 ),
                 &bypass_resp(&1, Jason.encode!(body1),
                   shape_handle: "my-shape-2",
                   last_offset: "1_0",
                   schema: Jason.encode!(%{"id" => %{type: "text"}})
                 )
               ],
               {"1_0", "my-shape"} => [
                 &bypass_resp(&1, Jason.encode!([%{"headers" => %{"control" => "must-refetch"}}]),
                   status: 400
                 ),
                 &bypass_resp(&1, Jason.encode!(body1),
                   shape_handle: "my-shape",
                   last_offset: "2_0"
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

      assert [
               %ChangeMessage{
                 headers: @insert,
                 offset: offset(1, 0),
                 value: %{"id" => "1111"}
               },
               up_to_date(1, 0),
               %ControlMessage{control: :must_refetch, offset: offset(1, 0)},
               %ChangeMessage{
                 headers: @insert,
                 offset: offset(1, 0),
                 value: %{"id" => "1111"}
               },
               up_to_date(1, 0)
             ] = stream(ctx, 5)
    end

    test "redirects to another shape id when given a 409", ctx do
      body1 = [
        %{
          "headers" => %{"operation" => "insert"},
          "offset" => "1_0",
          "value" => %{"id" => "1111"}
        },
        %{"headers" => %{"control" => "up-to-date"}}
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

      assert [
               %ChangeMessage{
                 headers: @insert,
                 offset: offset(1, 0),
                 value: %{"id" => "1111"}
               },
               up_to_date(1, 0),
               %ControlMessage{control: :must_refetch, offset: offset(1, 0)},
               %ChangeMessage{
                 headers: @insert,
                 offset: offset(1, 0),
                 value: %{"id" => "1111"}
               },
               up_to_date(1, 0)
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

  defp bypass_response(ctx, responses) do
    %{table_name: table_name} = ctx
    path = "/v1/shape"
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
        %{"headers" => %{"control" => "up-to-date"}}
      ]

      body3 = [
        %{
          "headers" => %{"operation" => "insert"},
          "offset" => "2_0",
          "value" => %{"id" => "2222"}
        },
        %{"headers" => %{"control" => "up-to-date"}}
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
                 headers: %Headers{operation: :insert},
                 offset: %Electric.Client.Offset{tx: 1, op: 0}
               },
               %ChangeMessage{
                 value: %{"id" => "2222"},
                 headers: %Headers{operation: :insert},
                 offset: %Electric.Client.Offset{tx: 2, op: 0}
               },
               up_to_date(2, 0),
               %ResumeMessage{
                 shape_handle: "my-shape",
                 offset: offset(2, 0),
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
        %{"headers" => %{"control" => "up-to-date"}}
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
        offset: offset(2, 0),
        schema: %{id: %{type: "text"}}
      }

      events = stream(ctx, 3, resume: resume)

      assert [
               %ChangeMessage{
                 value: %{"id" => "3333"},
                 headers: %Headers{operation: :insert},
                 offset: %Electric.Client.Offset{tx: 3, op: 0}
               },
               %ChangeMessage{
                 value: %{"id" => "4444"},
                 headers: %Headers{operation: :insert},
                 offset: %Electric.Client.Offset{tx: 4, op: 0}
               },
               up_to_date(4, 0)
             ] = events
    end

    test "oneshot: true should after the first request", ctx do
      body1 = [
        %{
          "headers" => %{"operation" => "insert"},
          "offset" => "0_0",
          "value" => %{"id" => "1111", "value" => "original 1111"}
        },
        %{
          "headers" => %{"operation" => "insert"},
          "offset" => "0_0",
          "value" => %{"id" => "2222", "value" => "original 2222"}
        },
        %{
          "headers" => %{"operation" => "insert"},
          "offset" => "0_0",
          "value" => %{"id" => "3333", "value" => "original 3333"}
        },
        %{
          "headers" => %{"operation" => "update"},
          "offset" => "1234_0",
          "value" => %{"id" => "2222", "value" => "updated 2222"}
        }
      ]

      {:ok, responses} =
        start_supervised(
          {Agent,
           fn ->
             %{
               {"-1", nil} => [
                 &bypass_resp(&1, Jason.encode!(body1),
                   shape_handle: "my-shape",
                   last_offset: "1234_0",
                   schema: Jason.encode!(%{"id" => %{type: "text"}, "value" => %{type: "text"}})
                 )
               ],
               {"1234_0", "my-shape"} => [
                 fn _conn ->
                   raise "unexpected second request"
                 end
               ]
             }
           end}
        )

      bypass_response(ctx, responses)

      events = stream(ctx, oneshot: true) |> Enum.into([])

      assert [
               %ChangeMessage{
                 value: %{"id" => "1111", "value" => "original 1111"},
                 headers: %Headers{operation: :insert},
                 offset: %Electric.Client.Offset{tx: 0, op: 0}
               },
               %ChangeMessage{
                 value: %{"id" => "2222", "value" => "original 2222"},
                 headers: %Headers{operation: :insert},
                 offset: %Electric.Client.Offset{tx: 0, op: 0}
               },
               %ChangeMessage{
                 value: %{"id" => "3333", "value" => "original 3333"},
                 headers: %Headers{operation: :insert},
                 offset: %Electric.Client.Offset{tx: 0, op: 0}
               },
               %ChangeMessage{
                 value: %{"id" => "2222", "value" => "updated 2222"},
                 headers: %Headers{operation: :update},
                 offset: %Electric.Client.Offset{tx: 1234, op: 0}
               },
               %ResumeMessage{
                 shape_handle: "my-shape",
                 offset: offset(1234, 0),
                 schema: %{id: %{type: "text"}}
               }
             ] = events
    end
  end
end
