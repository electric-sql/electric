defmodule Burn.Messages do
  @moduledoc """
  Utility functions for working with Electric stream messages.
  """

  alias Electric.Client.Message

  def get_value(%Message.ChangeMessage{value: value}), do: value

  def is_insert(%Message.ChangeMessage{headers: %{operation: :insert}}), do: true
  def is_insert(_), do: false

  def is_update(%Message.ChangeMessage{headers: %{operation: :update}}), do: true
  def is_update(_), do: false

  def is_delete(%Message.ChangeMessage{headers: %{operation: :delete}}), do: true
  def is_delete(_), do: false
end
