defmodule Support.ClientHelpers do
  alias Electric.Client.Message.ControlMessage

  defmacro offset0, do: "0_inf"

  defmacro up_to_date() do
    quote(do: %ControlMessage{control: :up_to_date, global_last_seen_lsn: _})
  end

  defmacro up_to_date(lsn) do
    quote(
      do: %ControlMessage{
        control: :up_to_date,
        global_last_seen_lsn: unquote(lsn)
      }
    )
  end

  defmacro snapshot_end(_opts \\ []) do
    quote do
      %ControlMessage{
        control: :snapshot_end
      }
    end
  end
end
