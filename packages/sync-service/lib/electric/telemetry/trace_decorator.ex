defmodule Electric.Telemetry.TraceDecorator do
  use Decorator.Define, trace: 0

  @handle_functions [:handle_call, :handle_cast, :handle_events, :handle_info]

  def trace(body, %{name: name, arity: arity, args: args} = context) do
    quote do
      Electric.Telemetry.OpenTelemetry.with_span(
        unquote("#{module_name(context)}.#{function_name(context)}") <>
          Electric.Telemetry.TraceDecorator.parmeters_description(
            unquote(name),
            unquote(arity),
            unquote(hd(args))
          ),
        [],
        fn ->
          unquote(body)
        end
      )
    end
  end

  defp module_name(context) do
    context.module
    |> Module.split()
    |> List.last()
  end

  defp function_name(context), do: context.name

  def parmeters_description(function_name, arity, _args)
      when function_name not in @handle_functions do
    "/#{arity}"
  end

  def parmeters_description(_, _, atom) when is_atom(atom), do: "(#{atom})"
  def parmeters_description(_, _, {atom, _}) when is_atom(atom), do: "(#{atom})"
  def parmeters_description(_, _, {atom, _, _}) when is_atom(atom), do: "(#{atom})"
  def parmeters_description(_, _, {atom, _, _, _}) when is_atom(atom), do: "(#{atom})"
  def parmeters_description(_, _, {atom, _, _, _, _}) when is_atom(atom), do: "(#{atom})"
  def parmeters_description(_, arity, _), do: "/#{arity}"
end
