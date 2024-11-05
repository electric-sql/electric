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
    alias Ecto.Changeset
    use Ecto.Schema
    import Ecto.Changeset

    @primary_key false
    embedded_schema do
      field(:database_url, :string)
      field(:connection_params, :any, virtual: true)
      field(:database_use_ipv6, :boolean, default: false)
      field(:database_id, :string, autogenerate: {Electric.Utils, :uuid4, []})
    end

    def validate(params) do
      %__MODULE__{}
      |> cast(params, __schema__(:fields), message: fn _, _ -> "must be %{type}" end)
      |> validate_required([:database_url, :database_id])
      |> validate_database_url()
      |> apply_action(:validate)
      |> case do
        {:ok, params} ->
          result = Map.from_struct(params)

          result =
            if result.database_use_ipv6,
              do: Map.update!(result, :connection_params, &Keyword.put(&1, :ipv6, true)),
              else: result

          {:ok, result}

        {:error, changeset} ->
          {:error,
           Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
             Regex.replace(~r"%{(\w+)}", msg, fn _, key ->
               opts |> Keyword.get(String.to_existing_atom(key), key) |> to_string()
             end)
           end)}
      end
    end

    defp validate_database_url(changeset) do
      case Changeset.fetch_change(changeset, :database_url) do
        :error ->
          changeset

        {:ok, value} ->
          case Electric.ConfigParser.parse_postgresql_uri(value) do
            {:ok, parsed} -> Changeset.put_change(changeset, :connection_params, parsed)
            {:error, reason} -> Changeset.add_error(changeset, :database_url, reason)
          end
      end
    end
  end

  plug Plug.Parsers,
    parsers: [:json],
    json_decoder: Jason

  plug :put_resp_content_type, "application/json"

  # start_telemetry_span needs to always be the first plug after fetching query params.
  plug :start_telemetry_span

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

  defp create_tenant(%Conn{assigns: %{database_id: tenant_id} = assigns} = conn, _) do
    connection_opts = Electric.Utils.obfuscate_password(assigns.connection_params)

    OpenTelemetry.with_span("add_db.plug.create_tenant", [], fn ->
      case TenantManager.create_tenant(tenant_id, connection_opts, conn.assigns.config) do
        :ok ->
          conn
          |> send_resp(200, Jason.encode_to_iodata!(tenant_id))
          |> halt()

        {:error, {:tenant_already_exists, tenant_id}} ->
          conn
          |> send_resp(400, Jason.encode_to_iodata!("Database #{tenant_id} already exists."))
          |> halt()

        {:error, {:db_already_in_use, pg_id}} ->
          conn
          |> send_resp(
            400,
            Jason.encode_to_iodata!("The database #{pg_id} is already in use by another tenant.")
          )
          |> halt()

        {:error, error} ->
          conn
          |> send_resp(500, Jason.encode_to_iodata!(error))
          |> halt()
      end
    end)
  end

  defp open_telemetry_attrs(%Conn{assigns: assigns} = conn) do
    Electric.Plug.Utils.common_open_telemetry_attrs(conn)
    |> Map.merge(%{
      "tenant.id" => assigns[:database_id],
      "tenant.database_url" => assigns[:database_url]
    })
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
    OpentelemetryTelemetry.start_telemetry_span(OpenTelemetry, "plug_add_database", %{}, %{})
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
