defmodule Electric.DDLX.Parse.Build do
  defstruct steps: [], cmd: nil

  def new() do
    %__MODULE__{}
  end

  def expect(build, tokens) do
    %{build | steps: [{:expect, tokens} | build.steps]}
  end

  def property(build, attr_name, fun) do
    %{build | steps: [{:property, {attr_name, fun}} | build.steps]}
  end

  def run(build, stmt, opts \\ []) do
    steps = Enum.reverse([:done | build.steps])

    steps
    |> Enum.reduce_while({stmt.tokens, %{}}, &process_step(&1, &2, opts))
    |> build_cmd(stmt)
  end

  defp build_cmd({:ok, attrs}, stmt) do
    {:ok, stmt.cmd.__struct__(attrs)}
  end

  defp build_cmd({:error, _} = error, _stmt) do
    error
  end

  defp process_step(:done, {[], cmd}, _opts) do
    {:halt, {:ok, cmd}}
  end

  defp process_step(:done, {tokens, cmd}, _opts) do
    raise "run out of steps with #{inspect(tokens)} remaining"
  end

  defp process_step(steps, {[], cmd}, _opts) do
    raise "run out of tokens with #{inspect(steps)} remaining"
  end

  defp process_step({:expect, keywords}, {tokens, cmd}, _opts) do
    {t, tokens} = Enum.split(tokens, length(keywords))
    match = Enum.zip(keywords, t)

    if Enum.all?(match, fn {expected, {received, pos}} -> expected == received end) do
      {:cont, {tokens, cmd}}
    else
      {expected, {token, pos}} =
        Enum.find(match, fn {expected, {received, pos}} -> expected != received end)

      # FIXME: replace with a {:halt, {:error, msg}}
      raise "got unexpected token: #{token} at position #{pos} (was expecting #{expected})"
    end
  end

  defp process_step({:property, {attr, value_fun}}, {[{token, pos} | tokens], cmd}, opts) do
    case value_fun.(token, opts) do
      {:ok, value} ->
        {:cont, {tokens, Map.put(cmd, attr, value)}}

      {:error, reason} ->
        # FIXME: replace with a {:halt, {:error, msg}}
        raise "unable to extract property #{attr} from #{inspect(token)}: got #{inspect(reason)}"
    end
  end

  # defp process_step(step, {tokens, cmd}) do
  #   db
  # end
end
