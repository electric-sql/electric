defmodule Electric.Satellite.Auth do
  @moduledoc """
  Module for authorization for Satellite clients
  """
  require Logger

  def child_spec do
    {Finch, name: __MODULE__, pools: %{:default => [size: 20]}}
  end

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

    req =
      Finch.build(
        :post,
        auth_url,
        [{"Content-Type", "application/json"}],
        "{\"token\": \"#{token}\", \"cluster_id\": \"#{cluster_id}\" }"
      )

    case Finch.request(req, __MODULE__) do
      {:ok, %Finch.Response{status: 200}} ->
        Logger.info("authorization passed #{id}")
        :ok

      {:ok, %Finch.Response{status: 401}} ->
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
