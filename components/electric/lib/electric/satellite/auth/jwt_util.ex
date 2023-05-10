defmodule Electric.Satellite.Auth.JWTUtil do
  @moduledoc """
  Utility functions for working with auth tokens.
  """

  alias Electric.Satellite.Auth

  # The name of the claim which holds the User ID in a JWT.
  @user_id_key "user_id"

  @doc """
  Fetch the User ID from the given map of claims.

  If `namespace` is `nil` or an empty string, the User ID is searched among the top-level claims. Otherwise, `claims`
  must include the claim whose name matches `namespace` and whose value is a map containing the "#{@user_id_key}" key.
  """
  @spec fetch_user_id(map, String.t() | nil) :: {:ok, Auth.user_id()} | {:error, :user_id}
  def fetch_user_id(claims, namespace) do
    user_id = get_user_id(claims, namespace)

    with :ok <- validate_user_id(user_id) do
      {:ok, user_id}
    end
  end

  defp get_user_id(claims, namespace) when is_binary(namespace) and namespace != "",
    do: get_in(claims, [namespace, @user_id_key])

  defp get_user_id(claims, _), do: claims[@user_id_key]

  defp validate_user_id(user_id) do
    if is_binary(user_id) and String.trim(user_id) != "" do
      :ok
    else
      {:error, :user_id}
    end
  end
end
