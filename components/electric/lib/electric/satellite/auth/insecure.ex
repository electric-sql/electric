defmodule Electric.Satellite.Auth.Insecure do
  @moduledoc """
  Implementation module of the "insecure" auth mode.

  This mode does not do any signature verification and treats the standard "iat", "exp", and "nbf" claims as optional.
  The only claim it does require is "user_id" which can be either a top-level claim or nested under a configurable
  namespace.

  You must opt in to using the "insecure" mode. We do not recommend to use it outside of development or local testing.
  As soon as you're ready to deploy Electric in any capacity, make sure to switch to the "jwt" auth mode.
  """

  @behaviour Electric.Satellite.Auth

  import Joken, only: [current_time: 0]
  alias Electric.Satellite.Auth
  alias Electric.Satellite.Auth.JWTUtil

  @doc """
  Validate configuration options and build a clean config for "insecure" auth.

  Returns a config map that can be passed to `validate_token/2`.

  ## Options

    * `namespace: <string>` - optional namespace under which the "user_id" claim will be looked up. If omitted,
      "user_id" must be a top-level claim.
  """
  @spec build_config(Access.t()) :: map
  def build_config(opts) do
    token_config =
      %{}
      |> Joken.Config.add_claim("iat", nil, &(&1 < current_time()))
      |> Joken.Config.add_claim("nbf", nil, &(&1 < current_time()))
      |> Joken.Config.add_claim("exp", nil, &(&1 > current_time()))

    %{namespace: opts[:namespace], joken_config: token_config}
  end

  @impl true
  def validate_token(token, config) do
    with {:ok, claims} <- JWTUtil.peek_claims(token),
         {:ok, _claims} <- Joken.validate(config.joken_config, claims),
         {:ok, user_id} <- JWTUtil.fetch_user_id(claims, config.namespace) do
      {:ok, %Auth{user_id: user_id}}
    else
      {:error, reason} -> {:error, JWTUtil.translate_error_reason(reason)}
    end
  end
end
