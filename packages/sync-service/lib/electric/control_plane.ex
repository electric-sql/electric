defmodule Electric.ControlPlane do
  @moduledoc """
  Functions that interact with the control plane that exists outside Electric.
  """
  require Logger

  defstruct [
    :base_url,
    :auth,
    paths: %{
      "tenant_shape" => %{
        "url" => "/v1/shape",
        "params" => %{
          "offset" => "-1",
          "table" => "databases",
          "where" => "electric_url ILIKE '%%{instance_id}'",
          "select" => "id,connection_url"
        }
      }
    }
  ]

  @type t() :: %__MODULE__{
          base_url: String.t(),
          auth: nil | String.t() | {:basic, String.t()} | {:bearer, String.t()},
          paths: %{optional(String.t()) => map()}
        }

  def parse_config(""), do: nil

  def parse_config(config_string) do
    result = Jason.decode!(config_string)

    %__MODULE__{
      base_url: Map.fetch!(result, "base_url"),
      auth: Map.get(result, "auth", nil),
      paths: Map.get(result, "paths", %__MODULE__{}.paths)
    }
  end

  @spec list_tenants(t(), keyword()) ::
          {:ok, included :: list(map()), deleted :: list(map())} | {:error, :unreachable}
  def list_tenants(%__MODULE__{} = plane, opts) do
    %{electric_instance_id: instance_id} =
      Keyword.get_lazy(opts, :app_config, fn -> Electric.Application.Configuration.get() end)

    plane
    |> build_req("tenant_shape", instance_id)
    |> read_electric_api_until_done()
    |> case do
      {:ok, result} when is_list(result) ->
        # We expect the control plane to fulfill the Electric API, so we can decode it here from the complete response
        {ins_acc, del_acc} =
          result
          |> Stream.reject(&get_in(&1, ["headers", "control"]))
          |> Stream.map(
            &{get_in(&1, ["headers", "operation"]), Map.fetch!(&1, "key"),
             Map.fetch!(&1, "value")}
          )
          |> collect_ops()

        {:ok, Map.values(ins_acc), Map.values(del_acc)}

      {:ok, %Req.Response{status: status, body: body}} ->
        Logger.error(
          "Could not reach the control plane while trying to list tenants. Latest response has status #{status} and body #{inspect(body)}"
        )

        {:error, :unreachable}

      {:error, error} ->
        Logger.error(
          "Could not reach the control plane while trying to list tenants. Latest response was #{inspect(error)}"
        )

        {:error, :unreachable}
    end
  end

  # We need to read the Electric stream until complete
  defp read_electric_api_until_done(req, agg \\ []) do
    with {:ok, %Req.Response{status: 200} = resp} <-
           Req.get(req, max_retries: 4, retry_delay: 1_000) do
      if Req.Response.get_header(resp, "electric-up-to-date") != [] do
        {:ok, agg ++ resp.body}
      else
        [electric_handle] = Req.Response.get_header(resp, "electric-handle")
        [electric_offset] = Req.Response.get_header(resp, "electric-offset")

        req
        |> Req.merge(params: [handle: electric_handle, offset: electric_offset])
        |> read_electric_api_until_done(agg ++ resp.body)
      end
    end
  end

  defp build_req(%__MODULE__{} = plane, path_name, instance_id) do
    %{"url" => url} = path_spec = Map.fetch!(plane.paths, path_name)
    url = insert_instance_id(url, instance_id)

    params =
      path_spec
      |> Map.get("params", [])
      |> Enum.map(fn {k, v} -> {k, insert_instance_id(v, instance_id)} end)

    headers =
      path_spec
      |> Map.get("headers", [])
      |> Enum.map(fn {k, v} -> {k, insert_instance_id(v, instance_id)} end)

    Req.new(
      base_url: plane.base_url,
      url: url,
      params: params,
      auth: plane.auth,
      headers: headers
    )
  end

  defp insert_instance_id(string, instance_id),
    do: String.replace(string, "%{instance_id}", to_string(instance_id))

  @spec collect_ops(Enumerable.t()) :: {map(), map()}
  defp collect_ops(ops) do
    Enum.reduce(ops, {%{}, %{}}, fn
      {"insert", key, value}, {ins_acc, del_acc} ->
        {Map.put(ins_acc, key, value), del_acc}

      {"update", key, value}, {ins_acc, del_acc} ->
        {Map.update!(ins_acc, key, &Map.merge(&1, value)), del_acc}

      {"delete", key, value}, {ins_acc, del_acc} ->
        {Map.delete(ins_acc, key), Map.put(del_acc, key, value)}
    end)
  end
end
