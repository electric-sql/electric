defmodule Electric.Application.Configuration do
  @moduledoc """
  A simple interface to `:persistent_term` that is designed for storing and retrieving the
  global application configuration (stored as a single map).
  """

  defstruct ~w[
    electric_instance_id
    storage
    persistent_kv
    connection_opts
    replication_opts
    pool_opts
    inspector
    shape_cache_opts
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
end
