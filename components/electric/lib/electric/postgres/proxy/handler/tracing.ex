defmodule Electric.Postgres.Proxy.Handler.Tracing do
  def do_trace(_action, _side, _session_id, []) do
    :ok
  end

  def do_trace(action, side, session_id, msgs) do
    config = config()

    if tracing_enabled?(config) do
      {label, colour} =
        case {action, side} do
          {:send, :client} -> {"[#{session_id}] -▶ #{side} ", :green}
          {:recv, :client} -> {"[#{session_id}] ◀- #{side} ", :green}
          {:send, :server} -> {"[#{session_id}] #{side} ◀- ", :yellow}
          {:recv, :server} -> {"[#{session_id}] #{side} -▶ ", :yellow}
        end

      IO.puts(
        IO.ANSI.format(
          [colour, label, :reset, PgProtocol.Message.inspect(msgs)],
          colour?(config) && IO.ANSI.enabled?()
        )
      )
    end
  end

  defmacro trace_recv(source, session_id, msgs) do
    quote do
      Electric.Postgres.Proxy.Handler.Tracing.do_trace(
        :recv,
        unquote(source),
        unquote(session_id),
        unquote(msgs)
      )
    end
  end

  defmacro trace_send(source, session_id, msgs) do
    quote do
      Electric.Postgres.Proxy.Handler.Tracing.do_trace(
        :send,
        unquote(source),
        unquote(session_id),
        unquote(msgs)
      )
    end
  end

  def tracing_enabled?(config) do
    Keyword.get(config, :enable, false)
  end

  def colour?(config) do
    Keyword.get(config, :colour, true)
  end

  defp config do
    Application.get_env(:electric, __MODULE__, enable: false)
  end
end
