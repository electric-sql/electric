defmodule Electric.Postgres.NameParserTest do
  use ExUnit.Case, async: true
  use ExUnitProperties

  alias Electric.Postgres.NameParser

  property "parse/2" do
    check all generated_name <- table_name(), {false, default_schema} <- unquoted_name() do
      assert {:ok, {schema, name}} =
               NameParser.parse(quote_name(generated_name), default_schema: default_schema)

      assert {schema, name} == extract_name(generated_name, default_schema)
    end
  end

  test "unquoted unicode names" do
    assert {:ok, {"thing", "Köln_en$ts"}} = NameParser.parse("thing.Köln_en$ts")
  end

  defp extract_name({{_, schema}, {_, name}}, _default_schema) do
    {schema, name}
  end

  defp extract_name({_, name}, default_schema) do
    {default_schema, name}
  end

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
            StreamData.member_of(Enum.concat([?a..?z, ?A..?Z, [?\s, ?_, ?", ?', ?-]]))
          ]),
          min_length: 3
        )
        |> StreamData.map(&to_string/1)
      }
    )
  end

  def name() do
    StreamData.one_of([unquoted_name(), quoted_name()])
  end

  def table_name() do
    StreamData.one_of([
      StreamData.tuple({name(), name()}),
      name()
    ])
  end

  def quote_name({{_, _} = schema, {_, _} = name}) do
    "#{quote_name(schema)}.#{quote_name(name)}"
  end

  def quote_name({false, name}) do
    name
  end

  def quote_name({true, name}) do
    ~s["#{escape_quotes(name)}"]
  end

  defp escape_quotes(name, acc \\ [])

  defp escape_quotes(<<>>, acc) do
    IO.iodata_to_binary(acc)
  end

  defp escape_quotes(<<"\"", rest::binary>>, acc) do
    escape_quotes(rest, [acc | "\"\""])
  end

  defp escape_quotes(<<c::binary-1, rest::binary>>, acc) do
    escape_quotes(rest, [acc | c])
  end
end
