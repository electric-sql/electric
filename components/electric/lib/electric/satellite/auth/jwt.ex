defmodule Electric.Satellite.Auth.JWT do
  @moduledoc """
  Implementation module of the "jwt" auth mode.

  This mode requires auth tokens to be signed. It also checks for the presence of at least "iat" and "exp" claims. If
  you include values for "iss" and/or "aud" claims in your configuration, those will also be enforced. The "user_id"
  claims must also be present, either at the top level or under a configurable namespace.

  Auth tokens must use the same signing algorithm as the one configured in Electric.

  The "jwt" auth mode is used by default.
  """

  @behaviour Electric.Satellite.Auth

  import Joken, only: [current_time: 0]

  alias Electric.Satellite.Auth
  alias Electric.Satellite.Auth.ConfigError
  alias Electric.Satellite.Auth.JWTUtil

  require Logger

  # 15 mins
  @token_max_age 60 * 15

  defguardp supported_signing_alg?(alg)
            when alg in ~w[HS256 HS384 HS512 RS256 RS384 RS512 ES256 ES384 ES512]

  @doc ~S"""
  Validate configuration options and build a clean config for "jwt" auth.

  Raises if any of the required options are missing or the key is too weak.

  Returns a config map that can be passed to `validate_token/2`.

  ## Options

    * `alg: {HS | RS | ES}{256 | 384 | 512}` (required) - the algorithm to use when verifying token signatures.

    * `key: <string>` (required) - the key to use for signature verification. It must be compatible with the configured
      algorithm, i.e. long enough for HS* algorithms or based on the appropriate curve for ES* algorithms.

      In the case of RS* and ES* algorithms, it must be a public key in PEM format, e.g.:

         "-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQY..."

    * `namespace: <string>` - optional namespace under which the "user_id" claim will be looked up. If omitted,
      "user_id" must be a top-level claim.

    * `iss: <string>` - optional issuer string to check all auth tokens with. If this is configured, JWTs without an
      "iss" claim will be considered invalid.

    * `aud: <string>` - optional audience string to check all auth tokens with. If this is configured, JWTs without an
      "aud" claim will be considered invalid.
  """
  @spec build_config!(Access.t()) :: map
  def build_config!(opts) do
    alg =
      case opts[:alg] do
        alg when is_binary(alg) and supported_signing_alg?(alg) ->
          alg

        _ ->
          raise ConfigError, "Missing or invalid 'alg' configuration option for JWT auth mode"
      end

    key =
      if key = opts[:key] do
        key
        |> validate_key(alg)
        |> prepare_key(alg)
      else
        raise ConfigError, "Missing 'key' configuration option for JWT auth mode"
      end

    token_config =
      %{}
      # Subtracting one second from generated "iat" and "nbf" claims is necessary for tests to pass.
      |> Joken.Config.add_claim("iat", fn -> current_time() - 1 end, &(&1 < current_time()))
      |> Joken.Config.add_claim("nbf", fn -> current_time() - 1 end, &(&1 < current_time()))
      |> add_exp_claim(in: @token_max_age)
      |> maybe_add_claim("iss", opts[:iss])
      |> maybe_add_claim("aud", opts[:aud])

    required_claims =
      ["iat", "exp", opts[:iss] && "iss", opts[:aud] && "aud"]
      |> Enum.reject(&is_nil/1)

    %{
      alg: alg,
      namespace: opts[:namespace],
      joken_signer: Joken.Signer.create(alg, key),
      joken_config: token_config,
      required_claims: required_claims
    }
  end

  defp validate_key(key, "HS256") when byte_size(key) < 32,
    do: raise(ConfigError, "The 'key' needs to be at least 32 bytes long for HS256")

  defp validate_key(key, "HS384") when byte_size(key) < 48,
    do: raise(ConfigError, "The 'key' needs to be at least 48 bytes long for HS384")

  defp validate_key(key, "HS512") when byte_size(key) < 64,
    do: raise(ConfigError, "The 'key' needs to be at least 64 bytes long for HS512")

  defp validate_key(key, _alg), do: key

  defp prepare_key(raw_key, "HS" <> _), do: raw_key
  defp prepare_key(raw_key, "RS" <> _), do: %{"pem" => raw_key}
  defp prepare_key(raw_key, "ES" <> _), do: %{"pem" => raw_key}

  defp add_exp_claim(token_config, in: seconds),
    do:
      Joken.Config.add_claim(
        token_config,
        "exp",
        fn -> current_time() + seconds end,
        &(&1 > current_time())
      )

  defp add_exp_claim(token_config, at: unix_time),
    do: Joken.Config.add_claim(token_config, "exp", fn -> unix_time end, &(&1 > current_time()))

  defp maybe_add_claim(token_config, _claim, nil), do: token_config

  defp maybe_add_claim(token_config, claim, val),
    do: Joken.Config.add_claim(token_config, claim, fn -> val end, &(&1 == val))

  @impl true
  def validate_token(token, config) do
    with {:ok, claims} <- verify_and_decode(token, config),
         :ok <- validate_claims(claims, config),
         {:ok, user_id} <- JWTUtil.fetch_user_id(claims, config.namespace) do
      {:ok, %Auth{user_id: user_id}}
    else
      {:error, reason} -> {:error, JWTUtil.translate_error_reason(reason)}
    end
  end

  @doc false
  # Only used in tests.
  def validate_token(token) do
    {__MODULE__, config} = Auth.provider()
    validate_token(token, config)
  end

  @doc false
  # Used in tests and the electric.gen.token Mix task.
  def create_token(user_id, opts \\ []) do
    {__MODULE__, config} = Auth.provider()

    token_config =
      Enum.reduce(opts, config.joken_config, fn
        {:expiry, unix_time}, acc -> add_exp_claim(acc, at: unix_time)
        {:issuer, issuer}, acc -> Joken.Config.add_claim(acc, "iss", fn -> issuer end)
      end)

    extra_claims = JWTUtil.put_user_id(%{}, config.namespace, user_id)
    Joken.generate_and_sign!(token_config, extra_claims, config.joken_signer)
  end

  ###

  defp verify_and_decode(token, config) do
    with {:ok, header} <- JWTUtil.peek_header(token),
         :ok <- validate_signing_alg(header["alg"], config.alg) do
      Joken.verify(token, config.joken_signer)
    end
  end

  defp validate_signing_alg(alg, alg), do: :ok
  defp validate_signing_alg(_, _), do: {:error, :signing_alg}

  defp validate_claims(claims, config) do
    required_claims_hook = {Joken.Hooks.RequiredClaims, config.required_claims}

    with {:ok, _claims} <-
           Joken.validate(config.joken_config, claims, nil, [required_claims_hook]) do
      :ok
    end
  end
end
