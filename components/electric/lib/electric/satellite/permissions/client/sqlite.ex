defmodule Electric.Satellite.Permissions.Client.SQLite do
  import Electric.Satellite.Permissions.Client.Format

  def create_trigger(args) do
    name =
      Keyword.get_lazy(args, :name, fn ->
        trigger_name(args[:table], args[:event])
      end)

    lines([
      "--",
      "",
      "INSERT INTO #{table(triggers_and_functions_table())} (name, type) VALUES (#{val(name)}, 'trigger');",
      "",
      "CREATE TRIGGER #{quot(name)}",
      indent([
        join_optional([
          Keyword.get(args, :when, "BEFORE"),
          args[:event],
          optional(args[:of], fn of -> ["OF ", lst(of, &quot/1)] end),
          "ON",
          table(args[:table])
        ]),
        "FOR EACH ROW",
        optional(args[:condition], &prefix(&1, "WHEN "))
      ]),
      "BEGIN",
      indent(List.wrap(args[:body])),
      "END;",
      ""
    ])
  end

  def rollback(message) do
    "SELECT RAISE(ROLLBACK, #{val(message)});"
  end

  def table(table, quot \\ true)

  def table(table, true), do: table(table, false) |> quot()

  def table({"electric", table}, false), do: "__electric_#{table}"
  def table({_schema, table}, false), do: table
  def table(%{schema: _schema, name: table}, false), do: table

  def trigger_name(table, action, suffixes \\ []) do
    trigger_name(table, action, __MODULE__, suffixes)
  end
end
