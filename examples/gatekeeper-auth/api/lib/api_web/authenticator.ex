defmodule ApiWeb.Authenticator do
  @moduledoc """
  `Electric.Client.Authenticator` implementation that generates
  and validates tokens.
  """
  alias Api.Token
  alias Electric.Client

  @behaviour Client.Authenticator
  @header "api-auth"

  def authenticate_shape(shape, _config) do
    %{@header => Token.generate(shape)}
  end

  def authenticate_request(request, _config) do
    request
  end

  def authorise(shape, headers) do
    with {:ok, token} <- Map.fetch(headers, @header) do
      Token.verify(shape, token)
    end
  end

  # Provides an `Electric.Client` that uses our `Authenticator`
  # implementation to generate signed auth tokens.
  #
  # This is configured in `./router.ex` to work with the
  # `Electric.Phoenix.Gateway.Plug`:
  #
  #     post "/:table", Electric.Phoenix.Gateway.Plug, client: &Authenticator.client/0
  #
  # Because `client/0` returns a client that's configured to use our
  # `ApiWeb.Authenticator`, then `ApiWeb.Authenticator.authenticate_shape/2`
  # will be called to generate an auth header that's included in the
  # response data that the Gateway.Plug returns to the client.
  #
  # I.e.: we basically tie into the `Gateway.Plug` machinery to use our
  # `Authenticator` to generate and return a signed token to the client.
  def client do
    base_url = Application.fetch_env!(:electric_phoenix, :electric_url)

    {:ok, client} = Client.new(base_url: base_url, authenticator: {__MODULE__, []})

    client
  end
end
