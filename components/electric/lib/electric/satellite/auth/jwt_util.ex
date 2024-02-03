defmodule Electric.Satellite.Auth.JWTUtil do
  @moduledoc """
  Utility functions for working with auth tokens.
  """

  alias Electric.Satellite.Auth
  alias Electric.Satellite.Auth.TokenError

  # The name of the claim which holds the User ID in a JWT.
  # `sub` is "subject" according to the JWT spec:
  # https://www.rfc-editor.org/rfc/rfc7519#section-4.1.2
  @user_id_key "sub"

  # We used to use `user_id` as the key, but we changed it to `sub` to be more
  # compliant with the JWT spec. However, we still want to support reading the
  # old `user_id` key for backwards compatibility.
  @legacy_user_id_key "user_id"

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
    do:
      get_in(claims, [namespace, @user_id_key]) ||
        get_in(claims, [namespace, @legacy_user_id_key])

  defp get_user_id(claims, _), do: claims[@user_id_key] || claims[@legacy_user_id_key]

  defp validate_user_id(user_id) do
    if is_binary(user_id) and String.trim(user_id) != "" do
      :ok
    else
      {:error, :user_id}
    end
  end

  @doc """
  Put the User ID into the claims map, optionally nesting it under a namespace.

  If `namespace` is `nil` or an empty string, the User ID claim is put at the top level of `claims`.
  """
  @spec put_user_id(map, String.t() | nil, Auth.user_id()) :: map

  def put_user_id(claims, namespace, user_id) when is_binary(namespace) and namespace != "" do
    Map.update(claims, namespace, %{@user_id_key => user_id}, &Map.put(&1, @user_id_key, user_id))
  end

  def put_user_id(claims, _namespace, user_id) do
    Map.put(claims, @user_id_key, user_id)
  end

  @doc """
  Convert a given token validation error reason into a %TokenError{} with a human-readable error description.
  """
  @spec translate_error_reason(term) :: %TokenError{}

  def translate_error_reason(:token_malformed), do: %TokenError{message: "Invalid token"}
  def translate_error_reason(:signing_alg), do: %TokenError{message: "Signing algorithm mismatch"}

  def translate_error_reason(:signature_error),
    do: %TokenError{message: "Invalid token signature"}

  def translate_error_reason(:user_id), do: %TokenError{message: "Missing or invalid 'user_id'"}

  def translate_error_reason(message: "Invalid token", missing_claims: [claim | _]),
    do: %TokenError{message: "Missing required #{inspect(claim)} claim"}

  def translate_error_reason(message: "Invalid token", claim: "exp", claim_val: _),
    do: %TokenError{message: "Expired token"}

  def translate_error_reason(message: "Invalid token", claim: "nbf", claim_val: _),
    do: %TokenError{message: "Token is not yet valid"}

  def translate_error_reason(message: "Invalid token", claim: claim, claim_val: val),
    do: %TokenError{message: "Invalid #{inspect(claim)} claim value: #{inspect(val)}"}

  # Joken delegates JWT parsing to erlang-jose which eventually calls Jason.decode!(). If the header or payload
  # happen to be empty or otherwise invalid JSON, both Joken.peek_header() and Joken.peek_claims() will blow up.

  @doc false
  def peek_header(token) do
    try do
      Joken.peek_header(token)
    rescue
      Jason.DecodeError -> {:error, :token_malformed}
    end
  end

  @doc false
  def peek_claims(token) do
    try do
      token
      |> maybe_add_trailing_dot()
      |> Joken.peek_claims()
    rescue
      Jason.DecodeError -> {:error, :token_malformed}
    end
  end

  defp maybe_add_trailing_dot(token) do
    case :binary.split(token, ".", [:global]) do
      [_header, _payload] -> token <> "."
      [_header, _payload, _signature] -> token
      _ -> raise Jason.DecodeError
    end
  end

  def gen_timestamp(add_seconds \\ 0) do
    now() + add_seconds
  end

  def past_timestamp?(ts) do
    ts - Electric.max_clock_drift_seconds() <= now()
  end

  def future_timestamp?(ts) do
    ts + Electric.max_clock_drift_seconds() >= now()
  end

  defp now, do: Joken.current_time()
end
