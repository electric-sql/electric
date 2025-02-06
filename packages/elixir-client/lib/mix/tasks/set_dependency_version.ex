defmodule Mix.Tasks.Electric.SetDependencyVersion do
  # uses sourceror rather than plain Code.string_to_quoted/1 and Macro.to_string/1
  # because the built-in versions nuke whitespace
  use Mix.Task

  @shortdoc "EHERE"

  def run(_args) do
    parse!()
    |> Sourceror.prewalk(&prewalk(&1, &2, version: current_electric_version()))
    |> Sourceror.to_string()
    |> write!()
  end

  defp current_electric_version do
    "../../../../sync-service/package.json"
    |> Path.expand(__DIR__)
    |> File.read!()
    |> Jason.decode!()
    |> Map.fetch!("version")
  end

  defp mix_file, do: Path.expand("../../../mix.exs", __DIR__)
  defp read!, do: File.read!(mix_file())
  defp parse!, do: Sourceror.parse_string!(read!())
  defp write!(contents), do: File.write!(mix_file(), contents)

  defp prewalk({:@, m1, [{:electric_version, m2, [value]}]}, state, version: new_version) do
    new_value =
      case value do
        {:__block__, _meta, [^new_version]} = orig ->
          IO.puts(
            :stderr,
            "\n====> Electric dependency already at current version #{inspect(new_version)}\n"
          )

          orig

        {:__block__, meta, [current_value]} ->
          IO.puts(
            :stderr,
            "\n====> Updating electric dependency from #{inspect(current_value)} to #{inspect(new_version)}\n"
          )

          {:__block__, meta, [new_version]}
      end

    {{:@, m1, [{:electric_version, m2, [new_value]}]}, state}
  end

  defp prewalk(ast, state, _), do: {ast, state}
end
