defmodule Electric.Application.Configuration do
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
    :ok = :persistent_term.put(@persistent_key, config)
    config
  end

  @spec get :: t
  def get, do: :persistent_term.get(@persistent_key)
end
