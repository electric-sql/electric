defmodule Electric.Satellite.Auth.Insecure do
  @behaviour Electric.Satellite.Auth

  alias Electric.Satellite.Auth

  @user_id_key "user_id"

  @impl true
  def validate_token(token, config) do
    with {:ok, claims} <- decode_claims(token),
         user_id = get_user_id(claims, config[:namespace]),
         :ok <- validate_user_id(user_id) do
      {:ok, %Auth{user_id: user_id}}
    else
      {:error, JWT.DecodeError} -> {:error, "invalid token"}
      {:error, %Jason.DecodeError{}} -> {:error, "invalid token"}
      {:error, :invalid_user_id} -> {:error, "missing or invalid 'user_id'"}
      {:error, _} -> {:error, :expired}
    end
  end

  @impl true
  def generate_token(user_id, _config, _opts) do
    {:ok, user_id}
  end

  ###
  # Utility functions
  ###

  # Custom decoding of JWT to support both unsigned and signed tokens while skipping signature verification.
  defp decode_claims(token) when is_binary(token) do
    with {:ok, unsigned_token} <- strip_signature(token) do
      JWT.verify(unsigned_token, %{alg: "none"})
    end
  end

  defp decode_claims(_), do: {:error, :invalid_token}

  defp strip_signature(token) do
    case String.split(token, ".", parts: 3) do
      [_header, _payload] ->
        # No signature, the header must already have {"alg": "none"}, so defer to the regular verification.
        # Note, however, that yajwt expects an empty signature field and doesn't work with tokens that are
        # missing it entirely. Hence the trailing dot.
        {:ok, token <> "."}

      [_header, _payload, ""] ->
        # Empty signature, same reasoning as above.
        {:ok, token}

      [header, payload, _signature] ->
        # We have to override the algorithm in the header before we can pass it to JWT.verify().
        with {:ok, header_map} <- JWT.Coding.decode(header) do
          new_header = header_map |> Map.put("alg", "none") |> JWT.Coding.encode!()
          {:ok, new_header <> "." <> payload <> "."}
        end

      _ ->
        :error
    end
  end

  defp get_user_id(claims, namespace) when is_binary(namespace) and namespace != "",
    do: get_in(claims, [namespace, @user_id_key])

  defp get_user_id(claims, _), do: claims[@user_id_key]

  defp validate_user_id(user_id) do
    if is_binary(user_id) and String.trim(user_id) != "" do
      :ok
    else
      {:error, :invalid_user_id}
    end
  end
end
