defmodule Electric.Postgres.Proxy.Handler.Tracing do
  @trace Mix.env() == :dev

  if @trace do
    def do_trace(_action, _side, []) do
    end

    def do_trace(action, side, msgs) do
      {label, colour} =
        case {action, side} do
          {:send, :client} -> {"🠞 #{side} ", :green}
          {:recv, :client} -> {"🠜 #{side} ", :green}
          {:send, :server} -> {"#{side} 🠜 ", :yellow}
          {:recv, :server} -> {"#{side} 🠞 ", :yellow}
        end

      IO.puts(IO.ANSI.format([colour, label, :reset, inspect(msgs)]))
    end

    defmacro trace_recv(source, msgs) do
      quote do
        Electric.Postgres.Proxy.Handler.Tracing.do_trace(:recv, unquote(source), unquote(msgs))
      end
    end

    defmacro trace_send(source, msgs) do
      quote do
        Electric.Postgres.Proxy.Handler.Tracing.do_trace(:send, unquote(source), unquote(msgs))
      end
    end
  else
    defmacro trace_recv(_source, _msgs) do
      nil
    end

    defmacro trace_send(_source, _msgs) do
      nil
    end
  end
end
