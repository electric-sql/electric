defmodule Electric.Shapes.Api.ErrorCode do
  @moduledoc """
  Error codes for Electric Shape API responses.

  Provides machine-readable error codes to categorize different types of failures.
  """

  @type error_code :: :stack_unavailable

  @doc """
  Stack is unavailable and cannot serve requests.

  This error indicates the Electric stack is not ready to respond to requests.
  The error message will contain details about which component is not ready.
  """
  @spec to_string(error_code()) :: String.t()
  def to_string(:stack_unavailable), do: "STACK_UNAVAILABLE"
end
