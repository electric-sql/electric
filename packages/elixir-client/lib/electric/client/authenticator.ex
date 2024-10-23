defmodule Electric.Client.Authenticator do
  @moduledoc """
  Behaviour to authenticate a `Electric.Client.Fetch.Request`.

  The assumption here is that authentication is per
  [`ShapeDefinition`](`Electric.Client.ShapeDefinition`) not per request.
  """

  alias Electric.Client.Fetch.Request
  alias Electric.Client.ShapeDefinition

  @type headers :: Request.headers()

  @doc """
  Update the given `Request` struct with authentication headers.

  Independent of the actual authentication mechanism, implementations of this
  Behaviour **MUST** set the `authenticated` field in the `Request` to `true`.
  """
  @callback authenticate_request(Request.t(), config :: term()) :: Request.authenticated()

  @doc "Get authentication headers for the given ShapeDefinition"
  @callback authenticate_shape(ShapeDefinition.t(), config :: term()) :: headers()
end
