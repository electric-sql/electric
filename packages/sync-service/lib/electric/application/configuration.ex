defmodule Electric.Application.Configuration do
  @behaviour Access

  @moduledoc """
  A simple interface to `:persistent_term` that is designed for storing and retrieving the
  global application configuration (stored as a single map).
  """

  defstruct ~w[
    electric_instance_id
    persistent_kv
    replication_opts
    pool_opts
  ]a

  @type t :: %__MODULE__{}

  @persistent_key __MODULE__

  @spec save(t) :: t
  def save(config) do
    # Make sure the application configuration is only stored once.
    try do
      _ = :persistent_term.get(@persistent_key)
      raise "Trying to overwrite previously stored application configuration"
    rescue
      ArgumentError ->
        :ok = :persistent_term.put(@persistent_key, config)
        config
    end
  end

  @spec get :: t
  def get, do: :persistent_term.get(@persistent_key)

  # Implementing the Access behaviour
  @impl Access
  def fetch(%__MODULE__{} = config, key) do
    Map.fetch(config, key)
  end

  @impl Access
  def get_and_update(%__MODULE__{} = config, key, fun) do
    Map.get_and_update(config, key, fun)
  end

  @impl Access
  def pop(%__MODULE__{} = config, key) do
    Map.pop(config, key)
  end
end
