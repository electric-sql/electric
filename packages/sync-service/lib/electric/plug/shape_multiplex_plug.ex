defmodule Electric.Plug.ShapeMultiplexPlug do
  @moduledoc """
  Upgrades an authenticated request to the internal shape live-wait multiplexer.

  The standalone router exposes this Plug at `GET /v1/shape/multiplex`. Embedded
  deployments may invoke it directly with the normal Electric API options plus:

    * `:availability_guard` — optional zero-arity function returning `:ok` while
      this process owns the tenant and `{:error, reason}` otherwise. It is
      checked before upgrade and periodically for established sockets.
    * `:subprotocol` — selected WebSocket subprotocol; defaults to
      `electric.shape-multiplex.v1`.

  The Plug also requires the underlying Electric stack to be the active
  instance. Authentication remains the responsibility of the enclosing router.
  """

  @behaviour Plug

  alias Electric.Shapes.Api.Multiplex
  alias Electric.Shapes.Api.Multiplex.Source
  alias Electric.Shapes.Api.Multiplex.WebSocket

  @max_frame_size 65_536

  @impl Plug
  def init(opts), do: opts

  @impl Plug
  def call(conn, opts) do
    api = fetch_opt!(opts, :api)
    source = Access.get(opts, :multiplex_source, Source)
    source_opts = Access.get(opts, :multiplex_source_opts)
    availability_guard = Access.get(opts, :availability_guard)
    subprotocol = Access.get(opts, :subprotocol, Multiplex.protocol())

    cond do
      not Multiplex.available?(api, source, source_opts, availability_guard) ->
        error_response(
          conn,
          503,
          "inactive_instance",
          "Multiplexing is only available on the active Electric instance",
          true,
          retry_after: 1
        )

      not offered_subprotocol?(conn, subprotocol) ->
        error_response(
          conn,
          400,
          "unsupported_subprotocol",
          "WebSocket subprotocol #{subprotocol} is required",
          false
        )

      true ->
        case WebSockAdapter.UpgradeValidation.validate_upgrade(conn) do
          :ok ->
            socket_opts = %{
              api: api,
              availability_guard: availability_guard,
              multiplex_source: source,
              multiplex_source_opts: source_opts,
              multiplex_status_check_interval:
                Access.get(opts, :multiplex_status_check_interval, 5_000)
            }

            conn
            |> Plug.Conn.put_resp_header("sec-websocket-protocol", subprotocol)
            |> WebSockAdapter.upgrade(WebSocket, socket_opts,
              early_validate_upgrade: false,
              max_frame_size: Access.get(opts, :multiplex_max_frame_size, @max_frame_size),
              timeout: max(60_000, api.long_poll_timeout * 3)
            )

          {:error, reason} ->
            error_response(conn, 400, "invalid_upgrade", reason, false)
        end
    end
  end

  defp offered_subprotocol?(conn, subprotocol) when is_binary(subprotocol) do
    conn
    |> Plug.Conn.get_req_header("sec-websocket-protocol")
    |> Enum.flat_map(&Plug.Conn.Utils.list/1)
    |> Enum.any?(&(&1 == subprotocol))
  end

  defp offered_subprotocol?(_conn, _subprotocol), do: false

  defp error_response(conn, status, code, message, retryable, opts \\ []) do
    conn =
      conn
      |> Plug.Conn.put_resp_content_type("application/json")
      |> Plug.Conn.put_resp_header("cache-control", "no-store")
      |> Plug.Conn.put_resp_header("surrogate-control", "no-store")

    conn =
      case Keyword.fetch(opts, :retry_after) do
        {:ok, seconds} ->
          Plug.Conn.put_resp_header(conn, "retry-after", Integer.to_string(seconds))

        :error ->
          conn
      end

    Plug.Conn.send_resp(
      conn,
      status,
      Jason.encode!(%{code: code, message: message, retryable: retryable})
    )
  end

  defp fetch_opt!(opts, key) do
    case Access.fetch(opts, key) do
      {:ok, value} -> value
      :error -> raise KeyError, key: key, term: opts
    end
  end
end
