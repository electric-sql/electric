defmodule Electric.Shapes.Consumer.EventHandler do
  @moduledoc false
  # Event handlers are the functional part of the consumer: they take handler
  # state plus an event and return new handler state plus declarative runtime
  # effects. Imperative startup/setup work is kept separate in SetupEffects.

  alias Electric.Shapes.Consumer.Effects

  @type t() :: term()

  @callback handle_event(t(), term()) ::
              {:ok, t(), [Effects.t()]} | {:error, term()}

  @spec handle_event(t(), term()) :: {:ok, t(), [Effects.t()]} | {:error, term()}
  def handle_event(handler, event) do
    handler.__struct__.handle_event(handler, event)
  end
end
