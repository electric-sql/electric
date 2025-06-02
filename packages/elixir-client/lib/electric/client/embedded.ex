if Code.ensure_loaded?(Electric.Shapes.Api) do
  defmodule Electric.Client.Embedded do
    alias Electric.Client.Fetch
    alias Electric.Shapes.Api

    @behaviour Electric.Client.Fetch

    @impl Electric.Client.Fetch
    def validate_opts(opts) do
      case Keyword.fetch(opts, :api) do
        {:ok, %Api{}} ->
          {:ok, opts}

        :error ->
          {:error, "missing required api: %#{Api}{} setting"}
      end
    end

    @impl Electric.Client.Fetch
    def fetch(%Fetch.Request{method: :delete} = request, opts) do
      {:ok, api} = Keyword.fetch(opts, :api)

      timestamp = DateTime.utc_now()

      with {:ok, request} <- Api.validate_for_delete(api, request_to_params(request)),
           %Api.Response{} = response <- Api.delete_shape(request) do
        {:ok, translate_response(response, timestamp)}
      end
    end

    def fetch(%Fetch.Request{method: :get} = request, opts) do
      {:ok, api} = Keyword.fetch(opts, :api)

      timestamp = DateTime.utc_now()

      with {:ok, request} <- Api.validate(api, request_to_params(request)),
           %Api.Response{} = response = Api.serve_shape_log(request) do
        {:ok, translate_response(response, timestamp)}
      end
    end

    defp translate_response(%Api.Response{} = response, timestamp) do
      %Fetch.Response{
        status: response.status,
        last_offset: convert_offset(response.offset),
        shape_handle: response.handle,
        schema: Api.schema(response),
        next_cursor: nil,
        request_timestamp: timestamp,
        # Ensure we enumerate the response body in the same process that made the
        # original api request so the cleanup shape process cleanup works
        body: Enum.into(response.body, [])
      }
    end

    defp request_to_params(%Fetch.Request{} = request) do
      Map.merge(
        request.params,
        %{
          offset: to_string(request.offset),
          handle: request.shape_handle,
          live: request.live,
          replica: request.replica
        }
      )
    end

    defp convert_offset(nil) do
      nil
    end

    defp convert_offset(%Electric.Replication.LogOffset{} = server_offset) do
      to_string(server_offset)
    end
  end
end
