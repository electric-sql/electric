defmodule Electric.Shapes.Api.Config do
  defstruct [
    :inspector,
    :pg_id,
    :registry,
    :shape_cache,
    :stack_events_registry,
    :stack_id,
    :storage,
    long_poll_timeout: 20_000,
    max_age: 60,
    stack_ready_timeout: 100,
    stale_age: 300,
    encoder: Electric.Shapes.Api.Encoder.JSON
  ]

  @type t() :: %__MODULE__{}

  @behaviour Access

  def new(opts) do
    __MODULE__ |> struct(opts) |> validate_encoder!()
  end

  defp validate_encoder!(config) do
    Map.update!(config, :encoder, &Electric.Shapes.Api.Encoder.validate!/1)
  end

  @impl Access
  def fetch(%__MODULE__{} = config, key) do
    Map.fetch(config, key)
  end

  @impl Access
  def get_and_update(%__MODULE__{} = _config, _key, _function) do
    raise RuntimeError, message: "Cannot get_and_update a #{__MODULE__} struct"
  end

  @impl Access
  def pop(%__MODULE__{} = _config, _key) do
    raise RuntimeError, message: "Cannot pop a #{__MODULE__} struct"
  end
end
