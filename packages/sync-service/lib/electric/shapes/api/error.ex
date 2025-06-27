defmodule Electric.Shapes.Api.Error do
  defstruct [:message, :status]

  @doc """
  When responding to client HTTP requests `must_refetch` should be called with `true`
  if the fetch request is using SSE mode and `false` if not.
  This ensures that the message is correctly formatted for the client
  since SSE expects single events but long polling expects an array of messages.
  IMPORTANT: Only use the version without arguments outside of HTTP requests.
  """
  def must_refetch(true) do
    # In SSE mode we send individual events
    # instead of an array of messages
    %__MODULE__{
      message: %{headers: %{control: "must-refetch"}},
      status: 409
    }
  end

  def must_refetch(false) do
    %__MODULE__{
      message: [%{headers: %{control: "must-refetch"}}],
      status: 409
    }
  end

  def must_refetch(), do: must_refetch(false)
end
