defmodule Electric.Postgres.NameParser do
  import NimbleParsec

  identifier =
    choice([
      # quoted identifier
      ignore(string(~s(")))
      |> repeat(
        choice([
          string(~s("")) |> replace(~s(")),
          utf8_char(not: ?")
        ])
      )
      |> ignore(string(~s("))),
      # unquoted identifier
      repeat(utf8_char([?a..?z, ?0..?9, ?_]))
    ])

  namespaced =
    optional(
      concat(
        identifier,
        ignore(string("."))
      )
      |> tag(:schema)
    )
    |> concat(identifier |> tag(:name))

  defparsec(:parse_name, identifier)
  defparsec(:parse_namespaced, namespaced)

  def parse(name, opts \\ []) do
    with {:ok, parsed, "", _, _, _} <- parse_namespaced(name),
         {:ok, name} <- Keyword.fetch(parsed, :name),
         schema = Keyword.get(parsed, :schema, Keyword.get(opts, :default_schema, "public")) do
      {:ok, {to_string(schema), to_string(name)}}
    end
  end

  def parse!(name, opts \\ []) do
    case parse(name, opts) do
      {:ok, name} ->
        name

      error ->
        raise ArgumentError, message: "Failed to parse name #{inspect(name)}: #{inspect(error)}"
    end
  end
end
