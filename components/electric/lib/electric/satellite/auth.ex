defmodule Electric.Satellite.Auth do
  @moduledoc """
  Behaviour module for authentication of Satellite clients.

  Electric supports two auth modes: "secure" and "insecure". Both work by validating a JWT token. See each
  implementation module's documentation for more info.
  """

  require Logger

  @enforce_keys [:user_id]
  defstruct [:user_id]

  @type user_id() :: binary()

  @type t() :: %__MODULE__{
          user_id: user_id()
        }

  @type provider() :: {module, map}
  @type validation_result() :: {:ok, t()} | {:error, %Electric.Satellite.Auth.TokenError{}}

  @doc "Validates the given token against the configuration provided"
  @callback validate_token(token :: binary, config :: map) :: validation_result()

  @spec validate_token(binary, provider) :: validation_result()
  def validate_token(token, {module, config} = _provider) do
    module.validate_token(token, config)
  end

  @doc """
  Retrieve the auth provider configuration
  """
  @spec provider() :: provider()
  def provider do
    config = Application.fetch_env!(:electric, Electric.Satellite.Auth)
    {_module, _config} = provider = Keyword.fetch!(config, :provider)
    provider
  end
end
