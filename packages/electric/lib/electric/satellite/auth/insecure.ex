defmodule Electric.Satellite.Auth.Insecure do
  @moduledoc """
  Implementation module of the "insecure" auth mode.

  This mode does not do any signature verification and treats the standard "iat", "exp", and "nbf" claims as optional.
  The only claim it does require is "sub" or "user_id" which can be either a top-level claim or nested under a
  configurable namespace.

  You must opt in to using the "insecure" mode. We do not recommend to use it outside of development or local testing.
  As soon as you're ready to deploy Electric in any capacity, make sure to switch to the "secure" auth mode.
  """

  @behaviour Electric.Satellite.Auth

  alias Electric.Satellite.Auth
  alias Electric.Satellite.Auth.JWTUtil

  @doc """
  Validate configuration options and build a clean config for "insecure" auth.

  Returns a config map that can be passed to `validate_token/2`.

  ## Options

    * `namespace: <string>` - optional namespace under which the "sub" or "user_id" claim will be looked up. If omitted,
      "sub" or "user_id" must be a top-level claim.
  """
  @spec build_config(keyword) :: {:ok, map} | {:error, atom, binary}
  def build_config(opts) do
    with {:ok, namespace} <- validate_opts(opts) do
      token_config =
        %{}
        |> Joken.Config.add_claim("iat", nil, &JWTUtil.past_timestamp?/1)
        |> Joken.Config.add_claim("nbf", nil, &JWTUtil.past_timestamp?/1)
        |> Joken.Config.add_claim("exp", nil, &JWTUtil.future_timestamp?/1)

      {:ok, %{namespace: namespace, joken_config: token_config}}
    end
  end

  defp validate_opts(opts) do
    case Keyword.pop(opts, :namespace) do
      {namespace, []} ->
        {:ok, namespace}

      {_, [{key, _} | _extraneous_opts]} ->
        {:error, key,
         "is not valid in Insecure auth mode. Did you forget to set AUTH_MODE=secure?"}
    end
  end

  @impl true
  def validate_token(token, config) do
    with {:ok, claims} <- JWTUtil.peek_claims(token),
         {:ok, _claims} <- Joken.validate(config.joken_config, claims),
         {:ok, user_id} <- JWTUtil.fetch_user_id(claims, config.namespace) do
      {:ok, %Auth{user_id: user_id, expires_at: claims["exp"]}}
    else
      {:error, reason} -> {:error, JWTUtil.translate_error_reason(reason)}
    end
  end
end
