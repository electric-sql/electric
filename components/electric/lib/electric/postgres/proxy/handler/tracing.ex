defmodule Electric.Postgres.Proxy.Handler.Tracing do
  @trace Mix.env() in [:dev]

  if @trace do
    def do_trace(_action, _side, _session_id, []) do
    end

    def do_trace(action, side, session_id, msgs) do
      {label, colour} =
        case {action, side} do
          {:send, :client} -> {"[#{session_id}] 🠞 #{side} ", :green}
          {:recv, :client} -> {"[#{session_id}] 🠜 #{side} ", :green}
          {:send, :server} -> {"[#{session_id}] #{side} 🠜 ", :yellow}
          {:recv, :server} -> {"[#{session_id}] #{side} 🠞 ", :yellow}
        end

      IO.puts(IO.ANSI.format([colour, label, :reset, PgProtocol.Message.inspect(msgs)]))
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
  else
    defmacro trace_recv(_source, _session_id, _msgs) do
      nil
    end

    defmacro trace_send(source, session_id, msgs) do
      quote do
        {_, _, _} = {unquote(source), unquote(session_id), unquote(msgs)}
      end
    end
  end
end
