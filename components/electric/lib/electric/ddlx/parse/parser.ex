defmodule Electric.DDLX.Parse.Parser do
  alias Electric.DDLX.Command
  alias Electric.DDLX.Parse.AssignParser
  alias Electric.DDLX.Parse.DisableParser
  alias Electric.DDLX.Parse.ElectrifyParser
  alias Electric.DDLX.Parse.Element
  alias Electric.DDLX.Parse.EnableParser
  alias Electric.DDLX.Parse.EnableParser
  alias Electric.DDLX.Parse.GrantParser
  alias Electric.DDLX.Parse.RevokeParser
  alias Electric.DDLX.Parse.SQLiteParser
  alias Electric.DDLX.Parse.UnassignParser
  alias Electric.DDLX.Parse.UnelectrifyParser

  @parsers [
    AssignParser,
    DisableParser,
    ElectrifyParser,
    EnableParser,
    GrantParser,
    RevokeParser,
    SQLiteParser,
    UnassignParser,
    UnelectrifyParser
  ]

  @quoted_re ~r/\"(?<quoted>[^\"]+)\"/u

  def is_ddlx(statement) do
    not is_nil(parser_for_statement(statement))
  end

  def parse(statement) do
    statement = String.trim_leading(statement)

    parser = parser_for_statement(statement)

    if parser do
      tokens = get_tokens(statement, parser.token_regex)

      results =
        Enum.reduce_while(
          parser.elements,
          %{status: :ok, tokens: tokens, values: %{}, message: ""},
          fn element, acc ->
            case Element.read(element, acc.tokens) do
              {:ok, shorter_tokens, nil, nil, nil} ->
                {:cont, Map.put(acc, :tokens, shorter_tokens)}

              {:ok, shorter_tokens, name, value, value_type} ->
                {:cont,
                 Map.merge(acc, %{
                   tokens: shorter_tokens,
                   values: Map.put(acc.values, name, {value_type, value})
                 })}

              {:error, message} ->
                {:halt, %{status: :error, tokens: [], values: %{}, message: message}}
            end
          end
        )

      case results.status do
        :ok -> parser.make_from_values(results.values)
        :error -> {:error, %Command.Error{sql: statement, message: results.message}}
      end
    end
  end

  def get_tokens(input, regex) do
    with_rockets = add_rockets(input)
    names = Regex.names(regex)
    captures = Regex.scan(regex, with_rockets, capture: :all_names)

    for capture <- captures do
      index = Enum.find_index(capture, fn x -> x != "" end)
      token_type = Enum.at(names, index)
      raw_value = Enum.at(capture, index) |> remove_rockets()

      case token_type do
        "keyword" -> {:keyword, String.downcase(raw_value)}
        "collection" -> {:collection, raw_value}
        "name" -> {:name, raw_value}
        "string" -> {:string, raw_value}
      end
    end
  end

  def add_rockets(input) do
    bits = Regex.scan(@quoted_re, input)

    Enum.reduce(bits, input, fn [match, capture], acc ->
      spaced = String.replace(capture, " ", "🚀")
      String.replace(acc, match, spaced)
    end)
  end

  def remove_rockets(input) do
    String.replace(input, "🚀", " ")
  end

  defp parser_for_statement(statement) do
    lower = String.downcase(statement)
    Enum.find(@parsers, fn parser -> parser.matches(lower) end)
  end
end
