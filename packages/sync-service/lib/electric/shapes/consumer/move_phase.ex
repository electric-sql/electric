defmodule Electric.Shapes.Consumer.MovePhase do
  @moduledoc false

  @type t() :: :idle | :waiting_move_in

  @spec idle?(t()) :: boolean()
  def idle?(:idle), do: true
  def idle?(_), do: false
end
