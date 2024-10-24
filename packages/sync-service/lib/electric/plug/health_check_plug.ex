defmodule Electric.Plug.HealthCheckPlug do
  alias Plug.Conn
  require Logger
  use Plug.Builder

  defmodule Params do
    use Ecto.Schema
    import Ecto.Changeset

    @primary_key false
    embedded_schema do
      field(:database_id, :string)
    end

    def validate(params) do
      %__MODULE__{}
      |> cast(params, __schema__(:fields), message: fn _, _ -> "must be %{type}" end)
      |> validate_required([:database_id])
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

  plug :fetch_query_params
  plug :validate_params
  plug :check_service_status
  plug :put_relevant_headers
  plug :send_response

  defp validate_params(%Conn{query_params: params} = conn, _) do
    case Params.validate(params) do
      {:ok, params} ->
        %{conn | assigns: Map.merge(conn.assigns, params)}

      {:error, error_map} ->
        conn
        |> send_resp(400, Jason.encode_to_iodata!(error_map))
        |> halt()
    end
  end

  # Match service status to a status code and status message,
  # keeping the message name decoupled from the internal representation
  # of the status to ensure the API is stable
  defp check_service_status(%Conn{assigns: %{database_id: database_id, config: opts}} = conn, _) do
    case Electric.TenantManager.get_tenant(database_id, opts) do
      {:ok, tenant} ->
        get_service_status = Access.fetch!(tenant, :get_service_status)

        {status_code, status_text} =
          case get_service_status.() do
            :waiting -> {503, "waiting"}
            :starting -> {503, "starting"}
            :active -> {200, "active"}
            :stopping -> {503, "stopping"}
          end

        conn |> assign(:status_text, status_text) |> assign(:status_code, status_code)

      {:error, :not_found} ->
        conn
        |> send_resp(404, "Database not found.")
        |> halt()
    end
  end

  defp put_relevant_headers(conn, _),
    do:
      conn
      |> put_resp_header("content-type", "application/json")
      |> put_resp_header("cache-control", "no-cache, no-store, must-revalidate")

  defp send_response(
         %Conn{assigns: %{status_text: status_text, status_code: status_code}} = conn,
         _
       ),
       do: send_resp(conn, status_code, Jason.encode!(%{status: status_text}))
end
