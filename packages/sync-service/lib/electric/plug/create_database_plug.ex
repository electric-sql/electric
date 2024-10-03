defmodule Electric.Plug.AddDatabasePlug do
  use Plug.Builder
  use Plug.ErrorHandler

  # The halt/1 function is redefined further down below
  import Plug.Conn, except: [halt: 1]

  alias OpenTelemetry.SemanticConventions, as: SC

  alias Electric.Telemetry.OpenTelemetry
  alias Plug.Conn

  alias Electric.TenantManager

  require Logger
  require SC.Trace

  defmodule Params do
    use Ecto.Schema
    import Ecto.Changeset

    @primary_key false
    embedded_schema do
      field(:DATABASE_URL, :string)
      field(:DATABASE_USE_IPV6, :boolean, default: false)
      field(:id, :string, autogenerate: {Electric.Utils, :uuid4, []})
    end

    def validate(params) do
      %__MODULE__{}
      |> cast(params, __schema__(:fields), message: fn _, _ -> "must be %{type}" end)
      |> validate_required([:DATABASE_URL, :id])
      |> apply_action(:validate)
      |> case do
        {:ok, params} ->
          {:ok, Map.from_struct(params)}

        {:error, changeset} ->
          {:error,
           Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
             Regex.replace(~r"%{(\w+)}", msg, fn _, key ->
               opts |> Keyword.get(String.to_existing_atom(key), key) |> to_string()
             end)
           end)}
      end
    end
  end

  plug Plug.Parsers,
    parsers: [:json],
    json_decoder: Jason

  # start_telemetry_span needs to always be the first plug after fetching query params.
  plug :start_telemetry_span

  plug :cors
  plug :put_resp_content_type, "application/json"
  plug :validate_body
  plug :create_tenant

  # end_telemetry_span needs to always be the last plug here.
  plug :end_telemetry_span

  defp validate_body(%Conn{body_params: params} = conn, _) do
    case Params.validate(params) do
      {:ok, params} ->
        %{conn | assigns: Map.merge(conn.assigns, params)}

      {:error, error_map} ->
        conn
        |> send_resp(400, Jason.encode_to_iodata!(error_map))
        |> halt()
    end
  end

  defp create_tenant(%Conn{assigns: %{id: tenant_id} = assigns} = conn, _) do
    %{DATABASE_URL: db_url, DATABASE_USE_IPV6: use_ipv6?} = assigns

    OpenTelemetry.with_span("add_db.plug.create_tenant", [], fn ->
      {:ok, database_url_config} = Electric.ConfigParser.parse_postgresql_uri(db_url)

      database_ipv6_config =
        if use_ipv6? do
          [ipv6: true]
        else
          []
        end

      connection_opts =
        Electric.Utils.obfuscate_password(database_url_config ++ database_ipv6_config)

      :ok = TenantManager.create_tenant(tenant_id, connection_opts, conn.assigns.config)

      conn
      |> send_resp(200, Jason.encode_to_iodata!(tenant_id))
      |> halt()
    end)
  end

  def cors(conn, _opts) do
    conn
    |> put_resp_header("access-control-allow-origin", "*")
    |> put_resp_header("access-control-expose-headers", "*")
    |> put_resp_header("access-control-allow-methods", "GET, POST, DELETE")
  end

  defp open_telemetry_attrs(%Conn{assigns: assigns} = conn) do
    %{
      "tenant.id" => assigns[:id],
      "tenant.DATABASE_URL" => assigns[:DATABASE_URL],
      "error.type" => assigns[:error_str],
      "http.request_id" => assigns[:plug_request_id],
      "http.query_string" => conn.query_string,
      SC.Trace.http_client_ip() => client_ip(conn),
      SC.Trace.http_scheme() => conn.scheme,
      SC.Trace.net_peer_name() => conn.host,
      SC.Trace.net_peer_port() => conn.port,
      SC.Trace.http_target() => conn.request_path,
      SC.Trace.http_method() => conn.method,
      SC.Trace.http_status_code() => conn.status,
      SC.Trace.http_response_content_length() => assigns[:streaming_bytes_sent],
      SC.Trace.net_transport() => :"IP.TCP",
      SC.Trace.http_user_agent() => user_agent(conn),
      SC.Trace.http_url() =>
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
    |> Map.merge(Map.new(conn.req_headers, fn {k, v} -> {"http.request.header.#{k}", v} end))
    |> Map.merge(Map.new(conn.resp_headers, fn {k, v} -> {"http.response.header.#{k}", v} end))
  end

  # TODO: move these functions into a shared module or a trait that we can mix in here and in the other plugs?
  defp client_ip(%Conn{remote_ip: remote_ip} = conn) do
    case get_req_header(conn, "x-forwarded-for") do
      [] ->
        remote_ip
        |> :inet_parse.ntoa()
        |> to_string()

      [ip_address | _] ->
        ip_address
    end
  end

  defp user_agent(%Conn{} = conn) do
    case get_req_header(conn, "user-agent") do
      [] -> ""
      [head | _] -> head
    end
  end

  #
  ### Telemetry
  #

  # Below, OpentelemetryTelemetry does the heavy lifting of setting up the span context in the
  # current Elixir process to correctly attribute subsequent calls to OpenTelemetry.with_span()
  # in this module as descendants of the root span, as they are all invoked in the same process
  # unless a new process is spawned explicitly.

  # Start the root span for the shape request, serving as an ancestor for any subsequent
  # sub-span.
  defp start_telemetry_span(conn, _) do
    OpentelemetryTelemetry.start_telemetry_span(OpenTelemetry, "Plug_shape_get", %{}, %{})
    add_span_attrs_from_conn(conn)
    conn
  end

  # Assign root span attributes based on the latest state of Plug.Conn and end the root span.
  #
  # We want to have all the relevant HTTP and shape request attributes on the root span. This
  # is the place to assign them because we keep this plug last in the "plug pipeline" defined
  # in this module.
  defp end_telemetry_span(conn, _ \\ nil) do
    add_span_attrs_from_conn(conn)
    OpentelemetryTelemetry.end_telemetry_span(OpenTelemetry, %{})
    conn
  end

  defp add_span_attrs_from_conn(conn) do
    conn
    |> open_telemetry_attrs()
    |> OpenTelemetry.add_span_attributes()
  end

  # This overrides Plug.Conn.halt/1 (which is deliberately "unimported" at the top of this
  # module) so that we can record the response status in the OpenTelemetry span for this
  # request.
  defp halt(conn) do
    conn
    |> end_telemetry_span()
    |> Plug.Conn.halt()
  end

  @impl Plug.ErrorHandler
  def handle_errors(conn, error) do
    OpenTelemetry.record_exception(error.reason, error.stack)

    error_str = Exception.format(error.kind, error.reason)

    conn
    |> assign(:error_str, error_str)
    |> end_telemetry_span()

    conn
  end
end
