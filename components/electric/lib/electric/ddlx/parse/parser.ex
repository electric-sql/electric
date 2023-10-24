defmodule Electric.DDLX.Parse.Macros do
  @doc """
  Produces a function head that matches a string in a case insensitive way.

  E.g.

       defkeyword :in?, "IN" do
          :ok
       end

  produces the code:

       def in?(<<c0::8, c1::8, rest::binary>> = stmt) when c0 in [?i, ?I] and c1 in [?n, ?N] do
         :ok
       end

  ## Options

  - `trailing` - should the keyword be followed by whitespace, defaults to `true`. 

  """
  defmacro deftoken(function, keyword, _opts \\ [], do: block) do
    chars =
      keyword
      |> to_string()
      |> String.codepoints()
      |> Enum.map(fn char -> [String.downcase(char), String.upcase(char)] end)
      |> Enum.map(fn [<<l::8>>, <<u::8>>] -> [l, u] end)

    chars = Enum.with_index(chars)
    pattern = build_match(chars)
    guard = build_guard(chars)

    quote do
      def unquote(function)(unquote(pattern) = var!(stmt)) when unquote(guard) do
        _ = var!(stmt)
        unquote(block)
      end
    end
  end

  defp match_var(i), do: Macro.var(:"c#{i}", Elixir)

  # <<c0::8, c1::8, ...>>
  defp build_match(chars) do
    {:<<>>, [], Enum.map(chars, fn {_c, i} -> quote(do: unquote(match_var(i)) :: 8) end)}
  end

  defp is_member(chars, i) do
    quote do
      unquote(match_var(i)) in unquote(chars)
    end
  end

  defp build_guard([{chars, i}]) do
    is_member(chars, i)
  end

  defp build_guard([{chars, i} | rest]) do
    quote do
      unquote(is_member(chars, i)) and unquote(build_guard(rest))
    end
  end
end

defmodule Electric.DDLX.Parse.Tokens do
  import Electric.DDLX.Parse.Macros

  @keywords ~w(alter table electric enable)a

  deftoken(:token, "ALTER", [], do: :alter)
  deftoken(:token, "TABLE", [], do: :table)
  deftoken(:token, "ELECTRIC", [], do: :electric)
  deftoken(:token, "ENABLE", [], do: :enable)
  deftoken(:token, "ASSIGN", [], do: :assign)
  deftoken(:token, "NULL", [], do: :null)
  deftoken(:token, "TO", [], do: :to)
  deftoken(:token, "IF", [], do: :if)
  def token(s), do: s
end

defmodule Electric.DDLX.Parse.Statement do
  defstruct [:stmt, :tokens, :cmd]

  def command(%__MODULE__{} = stmt) do
    stmt.cmd
  end
end

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
  alias Electric.DDLX.Parse.Tokens

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
    not is_nil(parser_for_statement(statement))
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
    |> dbg
    |> do_parse()
    |> build_cmd(opts)
  end

  defp do_parse(stmt) do
    :ddlx.parse(stmt.tokens)
  end

  defp build_cmd({:ok, {module, attrs}}, opts) do
    # FIXME: pass in default schema stuff
    module.build(attrs, opts)
    # {:ok, struct(module, attrs)}
  end

  defp build_cmd({:error, {{_line, position, _}, :ddlx, messages}}, _opts) do
    {:error, %{position: position, message: IO.iodata_to_binary(messages)}}
  end

  def build(stmt, opts) do
    stmt.cmd.builder()
    |> Build.run(stmt, opts)
  end

  def old_parse(statement) do
    statement = String.trim_leading(statement)

    parser = parser_for_statement(statement)

    if parser do
      tokens = get_tokens(statement, parser.token_regex())

      results =
        Enum.reduce_while(
          parser.elements(),
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
        :ok -> parser.make_from_values(results.values, statement)
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

  def tokens(str) do
    str
    |> token_stream()
    |> Enum.to_list()
  end

  def token_stream(str) do
    Stream.resource(
      fn -> {str, %{p: 0, k: 0, acc: [], sq: false, dq: false, cm: false}} end,
      &token_next/1,
      fn _ -> :ok end
    )
  end

  defguardp not_quoted(state) when not state.sq and not state.dq
  defguardp is_quoted(state) when state.sq or state.dq
  defguardp is_squoted(state) when state.sq
  defguardp is_dquoted(state) when state.dq
  defguardp is_alpha(char) when char in ?A..?Z or char in ?a..?z or char in [?_]

  @whitespace [?\s, ?\n, ?\r, ?\n, ?\t]

  defp token_out(%{acc: []} = _state) do
    []
  end

  defp token_out(state) when is_squoted(state) do
    s = IO.iodata_to_binary(state.acc)
    [{:string, {1, state.k, nil}, s}]
  end

  defp token_out(state) when is_dquoted(state) do
    s = IO.iodata_to_binary(state.acc)
    [{:ident, {1, state.k, nil}, s}]
  end

  defp token_out(state) do
    s = IO.iodata_to_binary(state.acc)

    case Tokens.token(s) do
      keyword when is_atom(keyword) ->
        [{keyword, {1, state.k, nil}, s}]

      string when is_binary(string) ->
        [{:ident, {1, state.k, nil}, s}]
    end
  end

  defp token_out(token, state) when is_atom(token) do
    [{token, {1, state.p, nil}}]
  end

  # defp token_out(%{acc: []}, _type) do
  #   []
  # end
  #
  # defp token_out(state, type) do
  #   [{type, state.k, IO.iodata_to_binary(state.acc)}]
  # end

  defp token_start(%{acc: []} = state) do
    %{state | k: state.p}
  end

  defp token_start(state) do
    state
  end

  defp token_next({:halt, state}), do: {:halt, state}
  defp token_next({str, state}), do: token_next(str, state)

  defp token_next(<<>>, %{acc: acc} = state) do
    {token_out(state), {:halt, state}}
  end

  defp token_next(<<?", rest::binary>>, state) when not_quoted(state) do
    {
      token_out(state) ++ token_out(:"\"", state),
      {rest, %{token_start(%{state | p: state.p + 1}) | dq: true, acc: []}}
    }
  end

  defp token_next(<<?', rest::binary>>, state) when not_quoted(state) do
    {
      token_out(state) ++ token_out(:"'", state),
      {rest, %{token_start(%{state | p: state.p + 1}) | sq: true, acc: []}}
    }
  end

  defp token_next(<<?", ?", rest::binary>>, state) when is_dquoted(state) do
    token_next(rest, %{state | p: state.p + 2, acc: [state.acc, ?", ?"]})
  end

  defp token_next(<<?", rest::binary>>, state) when is_dquoted(state) do
    {
      token_out(state) ++ token_out(:"\"", state),
      {rest, %{token_start(%{state | p: state.p + 1}) | dq: false, acc: []}}
    }
  end

  defp token_next(<<?', ?', rest::binary>>, state) when is_squoted(state) do
    token_next(rest, %{state | p: state.p + 2, acc: [state.acc, ?', ?']})
  end

  defp token_next(<<?', rest::binary>>, state) when is_squoted(state) do
    {
      token_out(state) ++ token_out(:"'", state),
      {rest, %{token_start(%{state | p: state.p + 1}) | sq: false, acc: []}}
    }
  end

  defp token_next(<<s::8, rest::binary>>, state) when is_quoted(state) do
    token_next(rest, %{state | p: state.p + 1, acc: [state.acc, s]})
  end

  defp token_next(<<s::8, rest::binary>>, %{acc: []} = state) when s in @whitespace do
    token_next(rest, %{token_start(state) | p: state.p + 1})
  end

  defp token_next(<<s::8, rest::binary>>, %{acc: acc} = state) when s in @whitespace do
    {token_out(state), {rest, %{token_start(%{state | acc: []}) | p: state.p + 1}}}
  end

  defp token_next(<<";", rest::binary>>, %{acc: acc} = state) do
    {token_out(state), {:halt, %{state | p: state.p + 1, acc: []}}}
  end

  defp token_next(<<c::8, rest::binary>>, %{acc: []} = state) when is_alpha(c) do
    token_next(rest, %{state | k: state.p, p: state.p + 1, acc: [c]})
  end

  defp token_next(<<c::8, rest::binary>>, %{acc: acc} = state) when is_alpha(c) do
    token_next(rest, %{state | p: state.p + 1, acc: [acc, c]})
  end

  defp token_next(<<?., rest::binary>>, %{acc: acc} = state) do
    {
      token_out(state) ++ token_out(:., state),
      {rest, %{token_start(%{state | p: state.p + 1}) | acc: []}}
    }
  end

  defp token_next(<<a::8, ?=, rest::binary>>, %{acc: acc} = state) when a in [?>, ?<] do
    {token_out(%{state | acc: acc}) ++ token_out(String.to_atom(<<a::8, ?=>>), state),
     {rest, %{state | p: state.p + 2, acc: []}}}
  end

  defp token_next(<<c::8, rest::binary>>, %{acc: acc} = state) when c in [?,, ?(, ?), ?:, ?=] do
    {token_out(%{state | acc: acc}) ++ token_out(String.to_atom(<<c::8>>), state),
     {rest, %{state | p: state.p + 1, acc: []}}}
  end
end
