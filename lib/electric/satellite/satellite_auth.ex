defmodule Electric.Satellite.Auth do
  @moduledoc """
  Module for authorization for Satellite clients.

  This provides a simple behaviour that allows for configuration of the authentication
  requirements.
  """

  require Logger

  @enforce_keys [:user_id]

  defstruct [:user_id]

  @type t() :: %__MODULE__{
          user_id: binary
        }

  @type provider() :: {module, Access.t()}
  @type validate_resp() :: {:ok, t()} | {:error, :expired} | {:error, reason :: binary}

  @doc "Validates the given token against the configuration provided"
  @callback validate_token(token :: binary, config :: Access.t()) :: validate_resp()

  @doc "Creates a token for the given user id. Only really for testing purposes"
  @callback generate_token(user_id :: binary, config :: Access.t(), opts :: Keyword.t()) ::
              {:ok, binary} | {:error, binary()}

  @spec validate_token(binary, provider) :: validate_resp()
  def validate_token(token, {module, config} = _provider) do
    module.validate_token(token, config)
  end

  @spec generate_token(binary, provider) :: {:ok, binary} | {:error, binary}
  def generate_token(user_id, {module, config} = _provider, opts \\ []) do
    module.generate_token(user_id, config, opts)
  end

  @doc """
  Retreive the auth provider configuration
  """
  @spec provider() :: provider() | no_return
  def provider do
    {:ok, config} = Application.fetch_env(:electric, Electric.Satellite.Auth)
    {:ok, {_module, _params} = provider} = Access.fetch(config, :provider)
    provider
  end
end
