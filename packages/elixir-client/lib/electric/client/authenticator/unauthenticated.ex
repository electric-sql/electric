defmodule Electric.Client.Authenticator.Unauthenticated do
  @moduledoc """
  Placeholder `Electric.Client.Authenticator` implementation that doesn't add
  any authentication params or headers to the `Request`.
  """

  @behaviour Electric.Client.Authenticator

  def authenticate_request(request, _config) do
    %{request | authenticated: true}
  end

  def authenticate_shape(_shape, _config) do
    %{}
  end
end
