defmodule Electric.Satellite.Auth do
  @moduledoc """
  Behaviour module for authentication of Satellite clients.
  """

  require Logger

  @enforce_keys [:user_id]
  defstruct [:user_id]

  @type user_id() :: binary()

  @type t() :: %__MODULE__{
          user_id: user_id()
        }

  @type provider() :: {module, map}
  @type validation_result() :: {:ok, t()} | {:error, :expired} | {:error, reason :: binary}

  @doc "Validates the given token against the configuration provided"
  @callback validate_token(token :: binary, config :: map) :: validation_result()

  @doc "Creates a token for the given user id. Only really for testing purposes"
  @callback generate_token(user_id :: user_id, config :: map, opts :: Keyword.t()) ::
              {:ok, binary} | {:error, binary()}

  @spec validate_token(binary, provider) :: validation_result()
  def validate_token(token, {module, config} = _provider) do
    module.validate_token(token, config)
  end

  @spec generate_token(binary, provider) :: {:ok, binary} | {:error, binary}
  def generate_token(user_id, {module, config} = _provider, opts \\ []) do
    module.generate_token(user_id, config, opts)
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
