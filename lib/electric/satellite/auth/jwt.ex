defmodule Electric.Satellite.Auth.JWT do
  alias Electric.Satellite.Auth

  require Logger

  @behaviour Auth

  defmodule Token do
    @spec verify(binary, binary, binary, Keyword.t()) ::
            {:ok, %{binary => any}} | {:error, Keyword.t()}
    def verify(token, key, iss, _opts \\ []) do
      JWT.verify(token, %{key: key, iss: iss})
    end

    # 15 mins
    @token_max_age 60 * 15

    # For internal use only. Create a valid access token for this app
    @doc false
    @spec create(binary, binary, binary, Keyword.t()) :: {:ok, binary} | no_return
    def create(user_id, key, iss, opts \\ []) do
      nonce =
        :crypto.strong_rand_bytes(16)
        |> Base.encode16(case: :lower)

      custom_claims = %{
        "user_id" => user_id,
        "nonce" => nonce,
        "type" => "access"
      }

      expiry = Keyword.get_lazy(opts, :expiry, &default_expiry/0)

      token_opts = %{
        alg: "HS256",
        exp: expiry,
        iss: iss
      }

      claims = Map.merge(custom_claims, token_opts)

      {:ok, JWT.sign(claims, %{key: key})}
    end

    defp default_expiry do
      System.os_time(:second) + @token_max_age
    end
  end

  @impl true
  def validate_token(token, config) do
    {:ok, key} = Keyword.fetch(config, :secret_key)
    {:ok, iss} = Keyword.fetch(config, :issuer)
    Logger.debug(["Validating token for issuer: ", iss])

    with {:ok, claims} <- Token.verify(token, key, iss, []),
         {:claims, %{"user_id" => user_id, "type" => "access"}} <- {:claims, claims} do
      {:ok, %Auth{user_id: user_id}}
    else
      {:claims, %{"type" => "refresh"}} ->
        {:error, "refresh token not valid for authentication"}

      {:claims, _claims} ->
        {:error, "invalid access token"}

      {:error, [exp: _]} ->
        {:error, :expired}

      {:error, errors} ->
        {:error, "token verification failed: #{inspect(errors)}"}
    end
  end

  @impl true
  def generate_token(user_id, config, opts) do
    {:ok, iss} = Keyword.fetch(config, :issuer)
    {:ok, key} = Keyword.fetch(config, :secret_key)

    Token.create(user_id, key, iss, opts)
  end

  def generate_token(user_id, opts \\ []) do
    with {__MODULE__, config} <- Electric.Satellite.Auth.provider() do
      generate_token(user_id, config, opts)
    else
      {provider, _config} ->
        {:error, "JWT authentication not configured, provider set to #{provider}"}
    end
  end

  def validate_token(token) do
    with {__MODULE__, config} <- Electric.Satellite.Auth.provider() do
      validate_token(token, config)
    else
      {provider, _config} ->
        {:error, "JWT authentication not configured, provider set to #{provider}"}
    end
  end
end
