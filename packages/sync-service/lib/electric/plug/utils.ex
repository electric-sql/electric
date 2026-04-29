defmodule Electric.Plug.Utils do
  @moduledoc """
  Utility functions for Electric endpoints, e.g. for parsing and validating
  path and query parameters.
  """

  @redacted_query_value "[REDACTED]"
  @sensitive_query_param_names MapSet.new(
                                 ~w(secret api_secret token access_token api_key password)
                               )

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

  def parse_columns_param([col | _] = columns) when is_binary(col) do
    {:ok, columns}
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
      next_interval + Enum.random(1..3_600)
    else
      next_interval
    end
  end

  alias OpenTelemetry.SemConv, as: SC
  @max_telemetry_string_bytes 2000
  @telemetry_body_subset_keys ~w(where order_by limit offset)

  @doc false
  def redact_query_string(nil), do: nil
  def redact_query_string(""), do: ""

  def redact_query_string(query_string) when is_binary(query_string) do
    query_string
    |> String.split("&", trim: false)
    |> Enum.map_join("&", &redact_query_segment/1)
  end

  def common_open_telemetry_attrs(%Plug.Conn{assigns: assigns} = conn) do
    sanitized_query_string = redact_query_string(conn.query_string)

    query_params_map =
      if is_struct(conn.query_params, Plug.Conn.Unfetched) do
        %{}
      else
        Map.new(conn.query_params, fn {k, v} ->
          {"http.query_param.#{k}", redact_query_param_value(k, v)}
        end)
      end

    body_params_map =
      assigns
      |> Map.get(:body_params, %{})
      |> telemetry_body_params()

    %{
      "error.type" => assigns[:error_str],
      "http.request_id" => assigns[:plug_request_id],
      "http.query_string" => sanitized_query_string,
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
          query: sanitized_query_string
        }
        |> to_string()
    }
    |> Map.filter(fn {_k, v} -> not is_nil(v) end)
    |> Map.merge(Map.get(conn.private, :telemetry_span_attrs, %{}))
    |> Map.merge(query_params_map)
    |> Map.merge(body_params_map)
    |> Map.merge(Map.new(conn.req_headers, fn {k, v} -> {"http.request.header.#{k}", v} end))
    |> Map.merge(Map.new(conn.resp_headers, fn {k, v} -> {"http.response.header.#{k}", v} end))
  end

  # GET requests already expose raw query params in telemetry. For POST requests,
  # only mirror the documented top-level subset fields. Legacy nested
  # %{"subset" => %{...}} bodies are still accepted by request parsing, but we
  # intentionally do not surface them in telemetry.
  defp telemetry_body_params(body_params) when body_params == %{}, do: %{}

  defp telemetry_body_params(body_params) when is_map(body_params) do
    if Enum.any?(@telemetry_body_subset_keys, &Map.has_key?(body_params, &1)) do
      subset_telemetry_attrs(body_params)
    else
      %{}
    end
  end

  defp telemetry_body_params(_), do: %{}

  defp subset_telemetry_attrs(params) do
    Enum.reduce(@telemetry_body_subset_keys, %{}, fn key, attrs ->
      prefix = "http.body_param.subset.#{key}"

      case Map.fetch(params, key) do
        {:ok, value} ->
          Map.merge(attrs, body_param_scalar_attr(value, prefix))

        :error ->
          attrs
      end
    end)
  end

  defp body_param_scalar_attr(nil, _prefix), do: %{}

  defp body_param_scalar_attr(value, prefix) do
    case scalar_attr_value(value) do
      {:ok, telemetry_value} -> %{prefix => telemetry_value}
      :skip -> %{}
    end
  end

  defp scalar_attr_value(nil), do: :skip

  defp scalar_attr_value(value) when is_binary(value) do
    {:ok, truncate_telemetry_string(value)}
  end

  defp scalar_attr_value(value) when is_boolean(value) or is_number(value), do: {:ok, value}
  defp scalar_attr_value(_value), do: :skip

  defp truncate_telemetry_string(value)
       when byte_size(value) <= @max_telemetry_string_bytes, do: value

  defp truncate_telemetry_string(value) do
    value
    |> binary_part(0, @max_telemetry_string_bytes)
    |> trim_invalid_utf8()
  end

  defp trim_invalid_utf8(value) when value == "", do: value

  defp trim_invalid_utf8(value) do
    if String.valid?(value) do
      value
    else
      trim_invalid_utf8(binary_part(value, 0, byte_size(value) - 1))
    end
  end

  defp user_agent(%Plug.Conn{} = conn) do
    case Plug.Conn.get_req_header(conn, "user-agent") do
      [] -> ""
      [head | _] -> head
    end
  end

  defp redact_query_segment(segment) do
    case String.split(segment, "=", parts: 2) do
      [key, _value] ->
        if sensitive_query_param?(decode_query_key(key)) do
          key <> "=" <> @redacted_query_value
        else
          segment
        end

      [_key] ->
        segment
    end
  end

  defp redact_query_param_value(key, value) do
    if sensitive_query_param?(key), do: @redacted_query_value, else: value
  end

  defp sensitive_query_param?(key) when is_binary(key) do
    MapSet.member?(@sensitive_query_param_names, String.downcase(key))
  end

  defp decode_query_key(key) do
    URI.decode_www_form(key)
  rescue
    ArgumentError -> key
  end

  defmodule CORSHeaderPlug do
    @behaviour Plug
    import Plug.Conn
    def init(opts), do: opts

    def call(conn, opts),
      do:
        conn
        |> put_resp_header("access-control-allow-origin", get_allowed_origin(conn, opts))
        |> put_resp_header("access-control-expose-headers", headers_to_expose())
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

    defp headers_to_expose do
      Enum.join(Electric.Shapes.Api.Response.electric_headers(), ",")
    end
  end

  defmodule PassAssignToOptsPlug do
    @behaviour Plug
    def init(plug: plug, assign_key: key) when is_atom(plug), do: {plug, key}
    def call(conn, {plug, key}), do: plug.call(conn, plug.init(conn.assigns[key]))
  end
end
