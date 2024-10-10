defmodule Support.ClientHelpers do
  alias Electric.Client.Offset
  alias Electric.Client.Message.ControlMessage

  defmacro offset(tx, op), do: quote(do: %Offset{tx: unquote(tx), op: unquote(op)})

  defmacro offset0, do: quote(do: offset(0, 0))

  defmacro up_to_date() do
    quote(do: %ControlMessage{control: :up_to_date, offset: %Offset{tx: _, op: _}})
  end

  defmacro up_to_date(tx, op) do
    quote(
      do: %ControlMessage{
        control: :up_to_date,
        offset: offset(unquote(tx), unquote(op))
      }
    )
  end

  defmacro up_to_date0(), do: quote(do: up_to_date(0, 0))
end
