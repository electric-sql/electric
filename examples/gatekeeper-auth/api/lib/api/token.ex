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
    with {:ok, shape_claim} <- validate(token) do
      matches(request_shape, shape_claim)
    end
  end

  defp validate(token) do
    with {:ok, %{"shape" => shape_claim}} <- JWT.verify_and_validate(token, JWT.signer()) do
      {:ok, shape_claim}
    else
      _alt ->
        {:error, :invalid}
    end
  end

  defp matches(%ShapeDefinition{} = request_shape, %{} = shape_claim) do
    with {:ok, token_shape} <- Shape.from(shape_claim) do
      Shape.matches(request_shape, token_shape)
    else
      _alt ->
        false
    end
  end
end
