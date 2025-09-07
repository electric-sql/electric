defmodule Electric.Plug.ServeSubsetPlug do
  alias Electric.Shapes.Api
  alias Electric.Postgres.Inspector
  use Plug.Builder, copy_opts_to_assign: :config
  alias Electric.Replication.Eval

  import Plug.Conn
  require Logger

  plug :fetch_query_params
  plug :put_resp_content_type, "application/json"

  plug :put_shape
  plug :validate_request
  plug :serve_subset

  defp put_shape(%Plug.Conn{assigns: %{config: config}} = conn, _) do
    shape_handle = conn.path_params["shape_handle"]

    case Electric.Shapes.get_shape_by_handle(config[:api], shape_handle) do
      nil ->
        send_resp(conn, 404, "Shape not found")

      shape ->
        {:ok, columns} = Inspector.load_column_info(shape.root_table_id, config[:api].inspector)

        conn
        |> assign(:shape_handle, shape_handle)
        |> assign(:shape, shape)
        |> assign(:columns, columns)
    end
  end

  defmodule Params do
    use Ecto.Schema
    import Ecto.Changeset

    embedded_schema do
      field(:order_by, :string)
      field(:limit, :integer)
      field(:offset, :integer)
      field(:where, :string)
      field(:params, {:map, :string}, default: %{})
    end

    def validate(api, columns, params) do
      %__MODULE__{}
      |> cast(params, __schema__(:fields))
      |> validate_required([:order_by, :limit])
      |> validate_number(:limit, greater_than: 0)
      |> validate_number(:offset, greater_than_or_equal_to: 0)
      |> validate_order_by(columns)
      |> validate_where(columns)
      |> apply_action(:validate)
      |> convert_error(api)
    end

    defp validate_order_by(%Ecto.Changeset{valid?: false} = changeset, _columns) do
      changeset
    end

    defp validate_order_by(changeset, columns) do
      validate_change(changeset, :order_by, fn _, value ->
        case Eval.Parser.validate_order_by(value, columns) do
          :ok -> []
          {:error, reason} -> [{:order_by, reason}]
        end
      end)
    end

    defp validate_where(%Ecto.Changeset{valid?: false} = changeset, _columns) do
      changeset
    end

    defp validate_where(changeset, columns) do
      params = fetch_field!(changeset, :params)

      validate_change(changeset, :where, fn _, value ->
        refs = Inspector.columns_to_expr(columns)

        with {:ok, where} <- Eval.Parser.parse_query(value),
             {:ok, _} <-
               Eval.Parser.validate_where_ast(where,
                 params: params,
                 refs: refs,
                 env: Eval.Env.new()
               ) do
          []
        else
          {:error, reason} -> [{:where, reason}]
        end
      end)
    end

    defp convert_error({:ok, params}, _api), do: {:ok, params}

    defp convert_error({:error, changeset}, api) do
      reason =
        traverse_errors(changeset, fn {msg, opts} ->
          Regex.replace(~r"%{(\w+)}", msg, fn _, key ->
            opts |> Keyword.get(String.to_existing_atom(key), key) |> to_string()
          end)
        end)

      {:error, Api.Response.invalid_request(api, errors: reason)}
    end
  end

  defp validate_request(%Plug.Conn{assigns: %{config: config}} = conn, _) do
    with {:ok, params} <- Params.validate(config[:api], conn.assigns.columns, conn.params) do
      conn
      |> assign(:params, params)
    else
      {:error, response} ->
        Api.Response.send(conn, response)
        |> halt()
    end
  end

  defp serve_subset(%Plug.Conn{assigns: %{shape: shape, params: params}} = conn, _) do
    with {:ok, {meta_info, data_stream}} <-
           Electric.Shapes.query_subset(shape,
             where: params.where,
             order_by: params.order_by,
             limit: params.limit,
             offset: params.offset,
             stack_id: conn.assigns.config[:stack_id]
           ) do
      %Api.Response{handle: conn.assigns.shape_handle}
      |> Map.put(
        :body,
        Stream.concat([
          [~s|{"metadata":|, Jason.encode_to_iodata!(meta_info), ~s|, "data": [|],
          Stream.intersperse(data_stream, ~s|,|),
          [~s|]}|]
        ])
      )
      |> Api.Response.final()
      |> then(&Api.Response.send_subset(conn, &1))
    end
  end
end
