defmodule Support.ClientHelpers do
  alias Electric.Client.Message.ControlMessage

  defmacro offset0, do: "0_inf"

  defmacro up_to_date() do
    quote(do: %ControlMessage{control: :up_to_date, offset: _})
  end

  defmacro up_to_date(offset) do
    quote(
      do: %ControlMessage{
        control: :up_to_date,
        offset: unquote(offset)
      }
    )
  end

  defmacro up_to_date0(), do: quote(do: up_to_date("0_inf"))
end
