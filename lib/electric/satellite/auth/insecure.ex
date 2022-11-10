defmodule Electric.Satellite.Auth.Insecure do
  alias Electric.Satellite.Auth

  @behaviour Auth

  @impl true
  def validate_token(user_id, _config) do
    {:ok, %Auth{user_id: user_id}}
  end

  @impl true
  def generate_token(user_id, _config, _opts) do
    {:ok, user_id}
  end
end
