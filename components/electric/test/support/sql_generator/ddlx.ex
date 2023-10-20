defmodule Electric.Postgres.SQLGenerator.DDLX do
  use Electric.Postgres.SQLGenerator

  def unquoted_name() do
    StreamData.tuple(
      {StreamData.constant(false), StreamData.string(Enum.concat([?a..?z, [?_]]), min_length: 3)}
    )
  end

  def quoted_name() do
    StreamData.tuple(
      # {true, StreamData.string(Enum.concat([[:printable], [?", ?_, ?-]]), min_length: 3)}
      {
        true,
        # throw out utf8 but ensure that we're including double quotes etc
        # because those are the awkward ones
        StreamData.list_of(
          StreamData.one_of([
            StreamData.codepoint(:printable),
            StreamData.member_of(Enum.concat([?a..?z, ?A..?Z, [?\s, ?_, ?", ?', ?-, ?\s]]))
          ]),
          min_length: 3
        )
        |> StreamData.map(&to_string/1)
      }
    )
  end

  def quoted_or_unquoted_name() do
    StreamData.one_of([unquoted_name(), quoted_name()])
  end

  def table_name() do
    StreamData.one_of([
      StreamData.tuple({quoted_or_unquoted_name(), quoted_or_unquoted_name()}),
      quoted_or_unquoted_name()
    ])
  end

  def table do
    table_name() |> Enum.take(1) |> hd
  end

  def enable(opts \\ []) do
    table_name =
      Keyword.get_lazy(opts, :table, &table/0)

    stmt(
      [
        # list_of(member_of(whitespace())),
        "ALTER",
        "TABLE",
        quote_name(table_name),
        "ENABLE",
        "ELECTRIC",
        optional(";")
      ],
      whitespace()
    )
  end
end
