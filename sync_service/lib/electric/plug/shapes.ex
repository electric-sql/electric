defmodule Electric.Plug.Shapes do
  use Plug.Router
  alias Electric.Replication.Changes
  alias Electric.Replication.ShapeLogStorage
  alias Electric.Shapes
  require Logger

  plug :match
  plug :dispatch

  get "/:table" do
    conn = Plug.Conn.fetch_query_params(conn)
    Logger.debug("Query params: #{inspect(conn.query_params)}")

    conn =
      if is_map_key(conn.query_params, "live") do
        conn
        |> put_resp_header("cache-control", "no-store, no-cache, must-revalidate, max-age=0")
        |> put_resp_header("pragma", "no-cache")
        |> put_resp_header("expires", "0")
      else
        put_resp_header(conn, "cache-control", "max-age=60, stale-while-revalidate=300")
      end

    cond do
      Map.get(conn.query_params, "offset", "-1") != "-1" ->
        # FIXME: this raises on non-int offset, so we definitely want to add proper validation here
        offset = String.to_integer(conn.query_params["offset"])
        shape_id = Map.fetch!(conn.query_params, "shapeId")
        unchanged_etag = "#{shape_id}-#{ShapeLogStorage.get_last_offset(shape_id) || 0}"

        if get_req_header(conn, "if-none-match") == [unchanged_etag] do
          send_resp(conn, 304, "")
        else
          # FIXME: we need to validate shape id here - it should match correct shape id for the provided shape definition
          conn =
            conn
            |> put_resp_header("x-electric-shape-id", shape_id)
            |> put_resp_content_type("application/json")

          {data, max_offset} =
            ShapeLogStorage.get_log(shape_id, offset)
            |> Enum.map_reduce(0, fn {offset, xid, change}, _ ->
              {%{
                 key: Changes.build_key(change),
                 value: Changes.to_json_value(change),
                 headers: %{action: Changes.get_action(change), txid: xid},
                 offset: offset
               }, offset}
            end)

          cond do
            data == [] and is_map_key(conn.query_params, "live") ->
              hold_until_change(conn, shape_id)

            true ->
              conn
              |> put_resp_header_if(
                not is_map_key(conn.query_params, "live"),
                "etag",
                "#{shape_id}-#{max_offset}"
              )
              |> send_resp(
                200,
                Jason.encode_to_iodata!(data ++ [%{headers: %{control: "up-to-date"}}])
              )
          end
        end

      true ->
        # FIXME: should have an error handler
        # FIXME: should not return snapshot immediately
        {:ok, shape_id, snapshot} = Shapes.get_or_create_shape(table)

        unchanged_etag = "#{shape_id}-#{ShapeLogStorage.get_last_offset(shape_id) || 0}"

        if get_req_header(conn, "if-none-match") == [unchanged_etag] do
          send_resp(conn, 304, "")
        else
          initial_rows =
            Enum.map(
              snapshot,
              &%{
                key: "public-" <> shape_id <> "-" <> &1["id"],
                value: &1,
                headers: %{action: "insert"},
                offset: 0
              }
            )

          {active_log, max_offset} =
            ShapeLogStorage.get_log(shape_id, -1, 1000)
            |> Stream.reject(&is_struct(elem(&1, 2), Changes.TruncatedRelation))
            |> Enum.map_reduce(0, fn {offset, xid, change}, _ ->
              {%{
                 key: Changes.build_key(change),
                 value: Changes.to_json_value(change),
                 headers: %{action: Changes.get_action(change), txid: xid},
                 offset: offset
               }, offset}
            end)

          conn
          |> put_resp_header("x-electric-shape-id", shape_id)
          |> put_resp_content_type("application/json")
          |> put_resp_header("etag", "#{shape_id}-#{max_offset}")
          |> send_resp(
            200,
            Jason.encode_to_iodata!(
              initial_rows ++
                active_log ++
                [
                  %{
                    headers: %{control: "up-to-date"}
                  }
                ]
            )
          )
        end
    end
  end

  def put_resp_header_if(conn, false, _, _), do: conn
  def put_resp_header_if(conn, true, key, value), do: put_resp_header(conn, key, value)

  def hold_until_change(conn, shape_id) do
    Registry.register(Registry.ShapeChanges, shape_id, [])

    conn =
      conn
      |> put_resp_header("x-electric-shape-id", shape_id)
      |> put_resp_content_type("application/json")

    dbg("Holding for #{shape_id}")

    receive do
      {:new_changes, changes} ->
        Registry.unregister(Registry.ShapeChanges, shape_id)

        msgs =
          Enum.map(changes, fn {offset, xid, change} ->
            %{
              key: Changes.build_key(change),
              value: Changes.to_json_value(change),
              headers: %{action: Changes.get_action(change), txid: xid},
              offset: offset
            }
          end) ++ [%{headers: %{control: "up-to-date"}}]

        send_resp(conn, 200, Jason.encode_to_iodata!(msgs))
    after
      5000 -> send_resp(conn, 204, "")
    end
  end
end
