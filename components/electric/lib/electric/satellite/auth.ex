defmodule Electric.Satellite.Auth do
  @moduledoc """
  Behaviour module for authentication of Satellite clients.

  Electric supports two auth modes: "secure" and "insecure". Both work by validating a JWT token. See each
  implementation module's documentation for more info.
  """

  alias __MODULE__
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

  @doc """
  Build an auth provider from the given auth mode and runtime configuration options.

  This is a helper function to be used in runtime config.
  """
  @spec build_provider!(String.t()) :: provider
  def build_provider!("insecure") do
    auth_config =
      [
        namespace: System.get_env("AUTH_JWT_NAMESPACE")
      ]
      |> Auth.Insecure.build_config()

    {Auth.Insecure, auth_config}
  end

  def build_provider!("secure") do
    auth_config =
      [
        alg: System.get_env("AUTH_JWT_ALG"),
        key: System.get_env("AUTH_JWT_KEY"),
        namespace: System.get_env("AUTH_JWT_NAMESPACE"),
        iss: System.get_env("AUTH_JWT_ISS"),
        aud: System.get_env("AUTH_JWT_AUD")
      ]
      |> Enum.filter(fn {_, val} -> is_binary(val) and String.trim(val) != "" end)
      |> Auth.Secure.build_config!()

    {Auth.Secure, auth_config}
  end

  def build_prodiver!(other) do
    raise "Unsupported auth mode: #{inspect(other)}"
  end
end
