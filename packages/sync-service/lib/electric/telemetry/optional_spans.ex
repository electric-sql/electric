defmodule Electric.Telemetry.OptionalSpans do
  def include?("filter." <> _), do: Application.get_env(:electric, :profile_where_clauses?)
  def include?(_), do: true
end
