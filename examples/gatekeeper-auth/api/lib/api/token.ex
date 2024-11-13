defmodule Api.Token do
  @moduledoc """
  Generate and validate JWT Tokens.
  """
  alias Api.Shape
  alias Electric.Client.ShapeDefinition

  defmodule JWT do
    use Joken.Config

    def signer do
      secret = Application.fetch_env!(:api, :auth_secret)

      Joken.Signer.create("HS256", secret)
    end
  end

  def generate(%ShapeDefinition{} = shape) do
    {:ok, token, _claims} = JWT.generate_and_sign(%{"shape" => shape}, JWT.signer())

    token
  end

  def verify(%ShapeDefinition{} = request_shape, token) do
    with {:ok, %{"shape" => token_params}} <- JWT.verify_and_validate(token, JWT.signer()),
         {:ok, token_shape} <- Shape.from(token_params) do
      Shape.matches(request_shape, token_shape)
    end
  end
end
