defmodule Electric.Satellite.Auth do
  @moduledoc """
  Module for authorization for Satellite clients
  """
  require Logger

  @spec validate_token(String.t(), String.t()) ::
          :ok | {:error, :auth_not_configured | term()}
  def validate_token(id, token) do
    auth_opts = Application.get_env(:electric, __MODULE__, nil)

    case validate_token_int(id, token, auth_opts) do
      :ok ->
        :ok

      {:error, :wrong_auth} = error ->
        error

      {:error, reason} = error ->
        Logger.error("authorization failed for #{id} with reason: #{inspect(reason)}")
        error
    end
  end

  defp validate_token_int(id, _token, nil) do
    Logger.emergency("authorization disabled, accept client with id: #{id}")
    :ok
  end

  defp validate_token_int(id, token, auth_opts) do
    auth_url = Keyword.get(auth_opts, :auth_url)
    cluster_id = Keyword.get(auth_opts, :cluster_id)

    case HTTPoison.post(
           auth_url,
           "{\"token\": \"#{token}\", \"cluster_id\": \"#{cluster_id}\" }",
           [{"Content-Type", "application/json"}]
         ) do
      {:ok, %HTTPoison.Response{status_code: 200}} ->
        Logger.info("authorization passed #{id}")
        :ok

      {:ok, %HTTPoison.Response{status_code: 401}} ->
        Logger.warn("authorization failed #{id}")
        {:error, :wrong_auth}

      {:ok, r} ->
        Logger.emergency("validate: #{inspect(r)}")
        {:error, :wrong_reponse}

      {:error, _} ->
        {:error, :auth_failed}
    end
  end
end
