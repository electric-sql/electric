defmodule Electric.Plug.Utils do
  @moduledoc """
  Utility functions for Electric endpoints, e.g. for parsing and validating
  path and query parameters.
  """

  @doc """
  Parse columns parameter from a string consisting of a comma separated list
  of potentially quoted column names into a sorted list of strings.

  ## Examples
      iex> Electric.Plug.Utils.parse_columns_param("")
      {:error, "Invalid zero-length delimited identifier"}
      iex> Electric.Plug.Utils.parse_columns_param("foo,")
      {:error, "Invalid zero-length delimited identifier"}
      iex> Electric.Plug.Utils.parse_columns_param("id")
      {:ok, ["id"]}
      iex> Electric.Plug.Utils.parse_columns_param("id,name")
      {:ok, ["id", "name"]}
      iex> Electric.Plug.Utils.parse_columns_param(~S|"PoT@To",PoTaTo|)
      {:ok, ["PoT@To", "potato"]}
      iex> Electric.Plug.Utils.parse_columns_param(~S|"PoTaTo,sunday",foo|)
      {:ok, ["PoTaTo,sunday", "foo"]}
      iex> Electric.Plug.Utils.parse_columns_param(~S|"fo""o",bar|)
      {:ok, [~S|fo"o|, "bar"]}
      iex> Electric.Plug.Utils.parse_columns_param(~S|"id,"name"|)
      {:error, ~S|Invalid unquoted identifier contains special characters: "id|}
  """
  @spec parse_columns_param(binary()) :: {:ok, [String.t(), ...]} | {:error, term()}

  def parse_columns_param(columns) when is_binary(columns) do
    columns
    # Split by commas that are not inside quotes
    |> String.split(~r/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
    |> Enum.reduce_while([], fn column, acc ->
      case Electric.Postgres.Identifiers.parse(column) do
        {:ok, casted_column} -> {:cont, [casted_column | acc]}
        {:error, reason} -> {:halt, {:error, reason}}
      end
    end)
    |> then(fn result ->
      case result do
        # TODO: convert output to MapSet?
        parsed_cols when is_list(parsed_cols) -> {:ok, Enum.reverse(parsed_cols)}
        {:error, reason} -> {:error, reason}
      end
    end)
  end

  @doc """
  Calculate the next interval that should be used for long polling based on the
  current time and previous interval used.

  Timestamp returned is in seconds and uses a custom epoch of 9th of October 2024, UTC.
  """
  @oct9th2024 ~U[2024-10-09 00:00:00Z]
  @spec get_next_interval_timestamp(integer(), binary() | nil) :: integer()
  def get_next_interval_timestamp(long_poll_timeout_ms, prev_interval \\ nil)

  def get_next_interval_timestamp(long_poll_timeout_ms, _)
      when div(long_poll_timeout_ms, 1000) == 0,
      do: 0

  def get_next_interval_timestamp(long_poll_timeout_ms, prev_interval) do
    long_poll_timeout_sec = div(long_poll_timeout_ms, 1000)
    diff_in_seconds = DateTime.diff(DateTime.utc_now(), @oct9th2024, :second)
    next_interval = ceil(diff_in_seconds / long_poll_timeout_sec) * long_poll_timeout_sec

    if "#{next_interval}" == prev_interval do
      next_interval + Enum.random(0..3_600)
    else
      next_interval
    end
  end

  alias OpenTelemetry.SemConv, as: SC

  def common_open_telemetry_attrs(%Plug.Conn{assigns: assigns} = conn) do
    query_params_map =
      if is_struct(conn.query_params, Plug.Conn.Unfetched) do
        %{}
      else
        Map.new(conn.query_params, fn {k, v} -> {"http.query_param.#{k}", v} end)
      end

    %{
      "error.type" => assigns[:error_str],
      "http.request_id" => assigns[:plug_request_id],
      "http.query_string" => conn.query_string,
      SC.ClientAttributes.client_address() => conn.remote_ip,
      SC.ServerAttributes.server_address() => conn.host,
      SC.ServerAttributes.server_port() => conn.port,
      SC.HTTPAttributes.http_request_method() => conn.method,
      SC.HTTPAttributes.http_response_status_code() => conn.status,
      SC.Incubating.HTTPAttributes.http_response_size() => assigns[:streaming_bytes_sent],
      SC.NetworkAttributes.network_transport() => :tcp,
      SC.NetworkAttributes.network_local_port() => conn.port,
      SC.UserAgentAttributes.user_agent_original() => user_agent(conn),
      SC.Incubating.URLAttributes.url_path() => conn.request_path,
      SC.URLAttributes.url_scheme() => conn.scheme,
      SC.URLAttributes.url_full() =>
        %URI{
          scheme: to_string(conn.scheme),
          host: conn.host,
          port: conn.port,
          path: conn.request_path,
          query: conn.query_string
        }
        |> to_string()
    }
    |> Map.filter(fn {_k, v} -> not is_nil(v) end)
    |> Map.merge(Map.get(conn.private, :telemetry_span_attrs, %{}))
    |> Map.merge(query_params_map)
    |> Map.merge(Map.new(conn.req_headers, fn {k, v} -> {"http.request.header.#{k}", v} end))
    |> Map.merge(Map.new(conn.resp_headers, fn {k, v} -> {"http.response.header.#{k}", v} end))
  end

  defp user_agent(%Plug.Conn{} = conn) do
    case Plug.Conn.get_req_header(conn, "user-agent") do
      [] -> ""
      [head | _] -> head
    end
  end

  def hold_conn_until_stack_ready(conn, _opts) do
    stack_id = conn.assigns.config[:stack_id]
    stack_ready_timeout = Access.get(conn.assigns.config, :stack_ready_timeout, 5_000)
    stack_events_registry = conn.assigns.config[:stack_events_registry]

    ref = Electric.StackSupervisor.subscribe_to_stack_events(stack_events_registry, stack_id)

    if Electric.ProcessRegistry.alive?(stack_id, Electric.Replication.Supervisor) do
      conn
    else
      receive do
        {:stack_status, ^ref, :ready} ->
          conn
      after
        stack_ready_timeout ->
          conn
          |> Plug.Conn.send_resp(503, Jason.encode!(%{message: "Stack not ready"}))
          |> Plug.Conn.halt()
      end
    end
  end

  defmodule CORSHeaderPlug do
    @behaviour Plug
    import Plug.Conn
    def init(opts), do: opts

    def call(conn, opts),
      do:
        conn
        |> put_resp_header("access-control-allow-origin", get_allowed_origin(conn, opts))
        |> put_resp_header("access-control-expose-headers", "*")
        |> put_resp_header("access-control-allow-methods", get_allowed_methods(conn, opts))

    defp get_allowed_methods(_conn, opts), do: Access.get(opts, :methods, []) |> Enum.join(", ")

    defp get_allowed_origin(conn, opts) do
      Access.get(
        opts,
        :origin,
        case Plug.Conn.get_req_header(conn, "origin") do
          [origin] -> origin
          [] -> "*"
        end
      )
    end
  end

  defmodule PassAssignToOptsPlug do
    @behaviour Plug
    def init(plug: plug, assign_key: key) when is_atom(plug), do: {plug, key}
    def call(conn, {plug, key}), do: plug.call(conn, plug.init(conn.assigns[key]))
  end
end
