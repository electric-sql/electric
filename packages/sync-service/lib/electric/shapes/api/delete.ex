defmodule Electric.Shapes.Api.Delete do
  @moduledoc false

  alias Electric.Shapes
  alias Electric.Shapes.Api
  alias Electric.Shapes.Api.Request
  alias Electric.Shapes.Api.Response

  def validate_for_delete(api, params) do
    with {:ok, request} <- validate_params_for_delete(api, params),
         {:ok, request} <- load_shape_info_for_delete(request) do
      {:ok, request}
    end
  end

  defp validate_params_for_delete(api, params) do
    with {:ok, request_params} <- Api.Params.validate_for_delete(api, params) do
      Api.request_for_params(api, request_params, %Response{
        shape: request_params.shape_definition
      })
    end
  end

  defp load_shape_info_for_delete(%Request{} = request) do
    request
    |> get_shape_handle()
    |> handle_shape_info_for_delete(request)
  end

  defp get_shape_handle(%Request{params: %{table: nil, handle: handle}} = _request)
       when is_binary(handle) do
    nil
  end

  defp get_shape_handle(%Request{} = request) do
    %{params: %{shape_definition: shape}, config: config} = request
    Shapes.get_shape(config, shape)
  end

  # delete request that just has the shape handle
  defp handle_shape_info_for_delete(
         nil,
         %Request{params: %{table: nil, handle: handle}} = request
       )
       when is_binary(handle) do
    if Shapes.has_shape?(request.config, handle) do
      {:ok,
       Map.update!(
         %{request | handle: handle},
         :response,
         &%{&1 | handle: handle}
       )}
    else
      {:error, Response.error(request, %{message: "No existing shape found"}, status: 404)}
    end
  end

  defp handle_shape_info_for_delete(nil, %Request{} = request) do
    {:error, Response.error(request, %{message: "No existing shape found"}, status: 404)}
  end

  # handle in params does not match handle of existing shape matching definition
  defp handle_shape_info_for_delete(
         {active_shape_handle, _offset},
         %Request{params: %{handle: handle}} = request
       )
       when not is_nil(handle) and handle != active_shape_handle do
    {:error, Response.shape_definition_mismatch(request)}
  end

  defp handle_shape_info_for_delete(
         {shape_handle, last_offset},
         %Request{} = request
       ) do
    {:ok,
     Map.update!(
       %{request | handle: shape_handle, last_offset: last_offset},
       :response,
       &%{&1 | handle: shape_handle}
     )}
  end
end
