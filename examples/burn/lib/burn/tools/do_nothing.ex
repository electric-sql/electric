defmodule Burn.Tools.DoNothing do
  use Burn.Tool

  @name "do_nothing"
  @description "Do nothing."

  @primary_key false
  embedded_schema do
  end

  def validate(_response, tool, attrs) do
    tool
    |> cast(attrs, [])
  end
end
