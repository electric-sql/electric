defmodule Electric.Satellite.Permissions.Client.Format do
  @electric "electric"
  @local_roles_table "local_roles"
  @local_roles_tombstone_table "local_roles_tombstone"
  @triggers_and_functions_table "permissions_triggers"

  @trigger_prefix "__electric_perms"

  def local_roles_table, do: {@electric, @local_roles_table}
  def local_roles_tombstone_table, do: {@electric, @local_roles_tombstone_table}
  def triggers_and_functions_table, do: {@electric, @triggers_and_functions_table}

  # pg triggers cannot be namespaced, they inherit their namespace from the table they're attached
  # to so we need this prefix even in pg
  def trigger_prefix, do: @trigger_prefix

  def trigger_name(table, action, dialect, suffixes) do
    Enum.join([@trigger_prefix, "#{dialect.table(table, false)}_#{action}" | suffixes], "_")
  end

  # quote name
  def quot(name) when is_binary(name), do: ~s["#{name}"]

  def json(obj), do: obj |> Jason.encode!() |> val()

  # list of things, mapped using mapper
  def lst(list, mapper) when is_list(list) and is_function(mapper, 1) do
    list |> Stream.map(mapper) |> Enum.intersperse(", ")
  end

  def and_(clauses) do
    clauses
    |> Enum.to_list()
    |> do_op("AND")
  end

  defp do_op([], _op), do: []

  defp do_op([clause], _op) do
    lines([clause])
  end

  defp do_op(clauses, op) do
    lines(intersperse_op(clauses, op))
  end

  # not just a simple Enum.intersperse  because we need to keep the clauses
  # on the same line as the `and`, so
  #   `[a, ["and", b], ["and", c]]`
  # not
  #   `[a, "and", b, "and", c]`
  defp intersperse_op([c1, c2 | rest], op) do
    [["(", c1, ")"], indent([[op, " (", c2, ")"] | intersperse_rest(rest, op)])]
  end

  defp intersperse_rest([], _op) do
    []
  end

  defp intersperse_rest([c1 | rest], op) do
    [[op, " (", c1, ")"] | intersperse_rest(rest, op)]
  end

  def when_(test) do
    lines(["WHEN (", indent([test]), ") THEN TRUE"])
  end

  def paren(inner), do: ["(", inner, ")"]

  def ref(table, col, dialect), do: [dialect.table(table), ".", quot(col)]

  def val(s) when is_binary(s), do: "'#{:binary.replace(s, "'", "''", [:global])}'"
  def val(n) when is_integer(n) or is_float(n), do: "#{n}"

  def lines(lines, indent \\ 0)

  def lines([], _indent) do
    []
  end

  def lines(lines, indent) do
    {:lines, indent, lines}
  end

  def indent(lines) do
    lines(lines, 1)
  end

  def format(lines) do
    lines
    |> format_lines(0)
    |> IO.iodata_to_binary()
  end

  defp format_lines(lines, cursor) when is_list(lines) do
    format_lines({:lines, 0, lines}, cursor)
  end

  defp format_lines({:lines, indent, {:lines, _, _} = inner}, cursor) do
    format_lines({:lines, indent, [inner]}, cursor)
  end

  defp format_lines({:lines, indent, lines}, cursor) when is_list(lines) do
    lines
    |> Stream.map(&format_line(&1, indent + cursor))
    |> Stream.reject(&is_nil/1)
    |> Enum.intersperse("\n")
  end

  defp format_line([{:lines, _, _} | _] = lines, cursor) do
    format_lines(lines, cursor)
  end

  defp format_line({:lines, _indent, _lines} = lines, cursor) do
    format_lines(lines, cursor)
  end

  defp format_line([], _cursor) do
    nil
  end

  defp format_line(nil, _cursor) do
    nil
  end

  defp format_line(line, cursor) when is_list(line) or is_binary(line) do
    [tab(cursor), line]
  end

  defp tab(0), do: []
  defp tab(n), do: ["    " | tab(n - 1)]

  def prefix({:lines, indent, [first | lines]}, prefix) do
    {:lines, indent, [[prefix, first] | lines]}
  end

  def join_optional(elements, join \\ " ") do
    elements
    |> Enum.reject(&is_nil/1)
    |> Enum.join(join)
  end

  def optional(nil, _), do: nil

  def optional(val, wrapper), do: wrapper.(val)
end
