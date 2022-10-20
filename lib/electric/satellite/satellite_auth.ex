defmodule Electric.Satellite.Auth do
  @moduledoc """
  Module for authorization for Satellite clients
  """

  require Logger

  @enforce_keys [:database_id, :user_id]

  defstruct [:database_id, :user_id]

  @type t() :: %__MODULE__{
          database_id: binary,
          user_id: binary
        }

  defmodule Token do
    @iss Application.compile_env!(:electric, [Electric.Satellite.Auth, :issuer])

    @spec verify(binary, binary) :: {:ok, %{binary => any}}
    def verify(database_id, token) do
      with {:ok, key} <- signing_key(database_id) do
        JWT.verify(token, %{key: key, iss: @iss})
      end
    end

    @spec secret_key() :: binary
    defp secret_key() do
      Application.fetch_env!(:electric, Electric.Satellite.Auth)[:secret_key]
    end

    @spec signing_key(binary) :: {:ok, binary}
    defp signing_key(database_id) do
      key =
        secret_key()
        |> hmac("EDBv01")
        |> hmac(database_id)

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
    @spec create(binary, binary) :: {:ok, binary} | no_return
    def create(database_id, user_id, opts \\ []) do
      {:ok, key} = signing_key(database_id)

      nonce =
        :crypto.strong_rand_bytes(16)
        |> Base.encode16(case: :lower)

      custom_claims = %{
        "database_id" => database_id,
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

  @spec validate_token(String.t(), String.t()) ::
          {:ok, t()} | {:error, :auth_not_configured | term()}
  def validate_token(database_id, token) do
    case validate_jwt_token(database_id, token) do
      {:ok, auth} ->
        {:ok, auth}

      {:error, reason} = error ->
        Logger.error("authorization failed for #{database_id} with reason: #{inspect(reason)}")
        error
    end
  end

  defp validate_jwt_token(database_id, token) do
    with {:ok, claims} <- Token.verify(database_id, token),
         {:claims, %{"database_id" => ^database_id, "user_id" => user_id, "type" => "access"}} <-
           {:claims, claims} do
      {:ok, %__MODULE__{database_id: database_id, user_id: user_id}}
    else
      {:claims, _claims} ->
        {:error, "invalid access token"}

      {:error, reason} ->
        {:error, "token verification failed: #{inspect(reason)}"}
    end
  end
end
