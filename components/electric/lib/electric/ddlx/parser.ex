defmodule Electric.DDLX.Parser do
  alias Electric.DDLX.Parser.{Statement, Tokenizer}
  alias Electric.DDLX.Command

  @type opt() :: {:default_schema, String.t()}
  @type opts() :: [opt()]

  def statement(stmt) do
    tokens = tokens(stmt)

    %Statement{stmt: stmt, tokens: tokens, cmd: nil}
  end

  def parse(ddlx, opts \\ []) do
    ddlx
    |> statement()
    |> do_parse()
    |> build_cmd(opts)
  end

  defp do_parse(stmt) do
    {:electric_ddlx_parser.parse(stmt.tokens), stmt}
  end

  defp build_cmd({{:ok, {module, attrs}}, _stmt}, opts) do
    module.build(attrs, opts)
  end

  defp build_cmd({{:error, {{_line, position, _}, :electric_ddlx_parser, messages}}, stmt}, _opts) do
    {:error,
     %Command.Error{
       position: position,
       message: IO.iodata_to_binary(:electric_ddlx_parser.format_error(messages)),
       sql: stmt.stmt
     }}
  end

  @spec tokens(String.t()) :: [Tokenizer.t()]
  def tokens(str) do
    Tokenizer.tokens(str)
  end
end
