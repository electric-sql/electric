defmodule Electric.Satellite.Auth.TokenError do
  @moduledoc """
  An exception type for JWT validation errors.
  """

  defexception [:message]
end
