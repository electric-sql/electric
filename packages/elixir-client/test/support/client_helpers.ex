defmodule Support.ClientHelpers do
  alias Electric.Client.Offset
  alias Electric.Client.Message.ControlMessage

  defmacro offset(tx, op), do: quote(do: %Offset{tx: unquote(tx), op: unquote(op)})

  defmacro offset0, do: quote(do: offset(0, 0))

  defmacro frontier() do
    quote(do: %ControlMessage{control: :frontier, offset: %Offset{tx: _, op: _}})
  end

  defmacro frontier(tx, op) do
    quote(
      do: %ControlMessage{
        control: :frontier,
        offset: offset(unquote(tx), unquote(op))
      }
    )
  end

  defmacro frontier0(), do: quote(do: frontier(0, 0))
end
