defmodule Electric.DDLX.Parser do
  alias Electric.DDLX.Parser.Tokenizer
  alias Electric.DDLX.Command

  @type opt() :: {:default_schema, String.t()}
  @type opts() :: [opt()]

  @spec parse(String.t(), opts()) :: {:ok, Command.t()} | {:error, Command.Error.t()}
  def parse(ddlx, opts \\ []) do
    ddlx
    |> Tokenizer.tokens()
    |> do_parse()
    |> build_cmd(ddlx, opts)
  end

  defp do_parse(tokens) do
    :electric_ddlx_parser.parse(tokens)
  end

  defp build_cmd({:ok, {module, attrs}}, _ddlx, opts) do
    module.build(attrs, opts)
  end

  defp build_cmd({:error, {{line, position, _}, :electric_ddlx_parser, messages}}, ddlx, _opts) do
    {:error,
     %Command.Error{
       line: line,
       position: position,
       message: IO.iodata_to_binary(:electric_ddlx_parser.format_error(messages)),
       sql: ddlx
     }}
  end
end
