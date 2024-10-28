defmodule Electric.Plug.RemoveDatabasePlug do
  use Plug.Builder

  alias Plug.Conn
  alias Electric.TenantManager

  require Logger

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
  plug :put_resp_content_type, "application/json"
  plug :validate_params
  plug :delete_tenant

  defp validate_params(%Conn{} = conn, _) do
    case Params.validate(conn.query_params) do
      {:ok, params} ->
        %{conn | assigns: Map.merge(conn.assigns, params)}

      {:error, error_map} ->
        conn
        |> send_resp(400, Jason.encode_to_iodata!(error_map))
        |> halt()
    end
  end

  defp delete_tenant(%Conn{assigns: %{database_id: tenant_id}} = conn, _) do
    case TenantManager.delete_tenant(tenant_id, conn.assigns.config) do
      :ok ->
        conn
        |> send_resp(200, Jason.encode_to_iodata!(tenant_id))
        |> halt()

      :not_found ->
        conn
        |> send_resp(404, Jason.encode_to_iodata!("Database #{tenant_id} not found."))
        |> halt()
    end
  end
end
