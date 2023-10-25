defmodule Electric.DDLX.Parse.Parser do
  alias Electric.DDLX.Command
  alias Electric.DDLX.Parse.AssignParser
  alias Electric.DDLX.Parse.DisableParser
  alias Electric.DDLX.Parse.ElectrifyParser
  alias Electric.DDLX.Parse.Statement
  alias Electric.DDLX.Parse.Element
  alias Electric.DDLX.Parse.EnableParser
  alias Electric.DDLX.Parse.GrantParser
  alias Electric.DDLX.Parse.RevokeParser
  alias Electric.DDLX.Parse.SQLiteParser
  alias Electric.DDLX.Parse.UnassignParser
  alias Electric.DDLX.Parse.UnelectrifyParser
  alias Electric.DDLX.Parse.Build
  alias Electric.DDLX.Parse.Tokenizer

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

  @commands [
    Command.Enable
  ]

  @quoted_re ~r/\"(?<quoted>[^\"]+)\"/u

  def is_ddlx(statement) do
    # not is_nil(parser_for_statement(statement))
    false
  end

  def statement(stmt) do
    tokens = tokens(stmt)

    %Statement{stmt: stmt, tokens: tokens, cmd: nil}
  end

  def cmd_for_tokens(tokens) do
    Enum.find(@commands, fn cmd -> cmd.matches_tokens(tokens) end)
  end

  def parse(ddlx, opts \\ []) do
    ddlx
    |> statement()
    |> do_parse()
    |> build_cmd(opts)
  end

  defp do_parse(stmt) do
    {:ddlx.parse(stmt.tokens), stmt}
  end

  defp build_cmd({{:ok, {module, attrs}}, _stmt}, opts) do
    module.build(attrs, opts)
  end

  defp build_cmd({{:error, {{_line, position, _}, :ddlx, messages}}, stmt}, _opts) do
    {:error, %{position: position, message: IO.iodata_to_binary(messages), sql: stmt.stmt}}
  end

  @spec tokens(String.t()) :: [Tokenizer.t()]
  def tokens(str) do
    Tokenizer.tokens(str)
  end
end
