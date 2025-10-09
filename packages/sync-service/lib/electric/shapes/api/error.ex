defmodule Electric.Shapes.Api.Error do
  defstruct [:message, :status]

  @must_refetch %{headers: %{control: "must-refetch"}}

  @doc """
  When responding to client HTTP requests, the value of the `live_sse` option
  passed to `must_refetch/1` (based on whether the fetch request is using SSE mode or not)
  determines the formatting of the response body: SSE clients expect single events but long
  polling clients expect an array of messages.
  """
  def must_refetch(opts) do
    message =
      if Keyword.get(opts, :live_sse, false) do
        @must_refetch
      else
        [@must_refetch]
      end

    %__MODULE__{message: message, status: 409}
  end
end
