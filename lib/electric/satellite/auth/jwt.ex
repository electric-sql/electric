defmodule Electric.Satellite.Auth.JWT do
  alias Electric.Satellite.Auth

  @behaviour Auth

  defmodule Token do
    @iss Application.compile_env!(:electric, [Electric.Satellite.Auth, :issuer])

    @spec verify(binary, binary, binary) :: {:ok, %{binary => any}} | {:error, Keyword.t()}
    def verify(global_cluster_id, token, shared_key) do
      with {:ok, key} <- signing_key(global_cluster_id, shared_key) do
        JWT.verify(token, %{key: key, iss: @iss})
      end
    end

    @spec signing_key(binary, binary) :: {:ok, binary}
    defp signing_key(global_cluster_id, shared_key) do
      key =
        shared_key
        |> hmac("EDBv01")
        |> hmac(global_cluster_id)

      {:ok, key}
    end

    @spec hmac(binary, binary) :: binary
    defp hmac(key, data) when byte_size(key) == 32 do
      :crypto.mac(:hmac, :sha256, key, data)
    end

    # 15 mins
    @token_max_age 60 * 15

    # For internal use only. Create a valid access token for this app
    @doc false
    @spec create(binary, binary, binary, Keyword.t()) :: {:ok, binary} | no_return
    def create(global_cluster_id, user_id, shared_key, opts \\ []) do
      {:ok, key} = signing_key(global_cluster_id, shared_key)

      nonce =
        :crypto.strong_rand_bytes(16)
        |> Base.encode16(case: :lower)

      custom_claims = %{
        "global_cluster_id" => global_cluster_id,
        "user_id" => user_id,
        "nonce" => nonce,
        "type" => "access"
      }

      expiry = Keyword.get_lazy(opts, :expiry, &default_expiry/0)

      token_opts = %{
        alg: "HS256",
        exp: expiry,
        iss: @iss
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
    {:ok, global_cluster_id} = Keyword.fetch(config, :global_cluster_id)
    {:ok, key} = Keyword.fetch(config, :secret_key)

    with {:ok, claims} <- Token.verify(global_cluster_id, token, key),
         {:claims,
          %{"global_cluster_id" => ^global_cluster_id, "user_id" => user_id, "type" => "access"}} <-
           {:claims, claims} do
      {:ok, %Auth{user_id: user_id}}
    else
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
    {:ok, global_cluster_id} = Keyword.fetch(config, :global_cluster_id)
    {:ok, key} = Keyword.fetch(config, :secret_key)

    Token.create(global_cluster_id, user_id, key, opts)
  end
end
