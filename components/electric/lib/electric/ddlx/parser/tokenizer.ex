defmodule Electric.DDLX.Parser.Tokenizer.Tokens do
  import Electric.DDLX.Parser.Macros

  deftoken(:token, "ALL", do: :ALL)
  deftoken(:token, "ALTER", do: :ALTER)
  deftoken(:token, "AND", do: :AND)
  deftoken(:token, "ASSIGN", do: :ASSIGN)
  deftoken(:token, "CHECK", do: :CHECK)
  deftoken(:token, "DELETE", do: :DELETE)
  deftoken(:token, "DISABLE", do: :DISABLE)
  deftoken(:token, "ELECTRIC", do: :ELECTRIC)
  deftoken(:token, "ENABLE", do: :ENABLE)
  deftoken(:token, "FROM", do: :FROM)
  deftoken(:token, "GRANT", do: :GRANT)
  deftoken(:token, "IF", do: :IF)
  deftoken(:token, "INSERT", do: :INSERT)
  deftoken(:token, "IS", do: :IS)
  deftoken(:token, "NOT", do: :NOT)
  deftoken(:token, "NULL", do: :NULL)
  deftoken(:token, "ON", do: :ON)
  deftoken(:token, "OR", do: :OR)
  deftoken(:token, "PRIVILEGES", do: :PRIVILEGES)
  deftoken(:token, "READ", do: :READ)
  deftoken(:token, "REVOKE", do: :REVOKE)
  deftoken(:token, "SELECT", do: :SELECT)
  deftoken(:token, "SQLITE", do: :SQLITE)
  deftoken(:token, "TABLE", do: :TABLE)
  deftoken(:token, "TO", do: :TO)
  deftoken(:token, "UNASSIGN", do: :UNASSIGN)
  deftoken(:token, "UPDATE", do: :UPDATE)
  deftoken(:token, "USING", do: :USING)
  deftoken(:token, "WRITE", do: :WRITE)
  def token(s), do: s
end

defmodule Electric.DDLX.Parser.Tokenizer do
  alias Electric.DDLX.Parser.Tokenizer.Tokens

  @type position() :: {integer(), integer(), nil | String.t()}
  @type t() :: {atom, position()} | {atom, position(), String.t()}

  @type state() :: %__MODULE__{
          l: pos_integer(),
          p: pos_integer(),
          k: pos_integer(),
          acc: iolist(),
          s: iodata()
        }

  defstruct l: 1, p: 0, k: 0, acc: [], s: nil

  @whitespace [?\s, ?\t]
  @non_ident ~c[.,():=-<>+*/]
  @operators ~w[<> <= >= !=]c
  @integers ?0..?9
  @line_endings ["\r\n", "\n", "\r"]

  defguardp is_alpha(char) when char in ?A..?Z or char in ?a..?z or char in [?_]
  defguardp is_num(char) when char in @integers

  def tokens(str) do
    str
    |> token_stream()
    |> Enum.to_list()
  end

  def token_stream(str) do
    Stream.resource(
      fn -> {str, %__MODULE__{}} end,
      &token_next/1,
      fn _ -> :ok end
    )
  end

  defp token_out(%{acc: []} = _state) do
    []
  end

  defp token_out(state) do
    s = IO.iodata_to_binary(state.acc)

    case Tokens.token(s) do
      keyword when is_atom(keyword) ->
        [{keyword, {state.l, state.k, nil}, s}]

      string when is_binary(string) ->
        [{:unquoted_identifier, {state.l, state.k, nil}, string}]
    end
  end

  defp token_out(token, state) when is_atom(token) do
    [{token, {state.l, state.k, nil}}]
  end

  defp token_out(token, value, source, state)
       when is_atom(token) and (is_list(value) or is_binary(value)) do
    [{token, {state.l, state.k, IO.iodata_to_binary(source)}, IO.iodata_to_binary(value)}]
  end

  defp token_out(token, value, source, state) do
    [{token, {state.l, state.k, IO.iodata_to_binary(source)}, value}]
  end

  defp token_start(%{acc: []} = state) do
    %{state | k: state.p}
  end

  defp token_start(state) do
    state
  end

  defp token_start!(state) do
    %{state | k: state.p}
  end

  defp newline(state) do
    %{state | l: state.l + 1, p: 0}
  end

  defp token_next({:halt, state}), do: {:halt, state}
  defp token_next({str, state}), do: token_next(str, state)

  defp token_next(<<>>, state) do
    {token_out(state), {:halt, state}}
  end

  for eol <- @line_endings do
    defp token_next(unquote(eol) <> rest, state) do
      token_next(rest, newline(state))
    end
  end

  defp token_next(<<?-, ?-, rest::binary>>, state) do
    consume_comment(rest, %{state | p: state.p + 2})
  end

  defp token_next(<<?", rest::binary>>, state) do
    consume_quoted_identifier(rest, %{token_start(state) | p: state.p + 1})
  end

  defp token_next(<<?', rest::binary>>, state) do
    consume_string(rest, %{token_start(state) | s: ?', p: state.p + 1})
  end

  defp token_next(<<?$, rest::binary>>, state) do
    consume_delimiter(
      rest,
      %{token_start(state) | p: state.p + 1, s: [?$]}
    )
  end

  defp token_next(<<s::8, rest::binary>>, %{acc: []} = state) when s in @whitespace do
    token_next(rest, %{token_start(state) | p: state.p + 1})
  end

  defp token_next(<<s::8, rest::binary>>, state) when s in @whitespace do
    {token_out(state), {rest, %{token_start(%{state | acc: []}) | p: state.p + 1}}}
  end

  defp token_next(<<";", _rest::binary>>, state) do
    {token_out(state), {:halt, %{state | p: state.p + 1, acc: []}}}
  end

  for [c1, c2] <- @operators do
    op = String.to_atom(<<c1, c2>>)

    defp token_next(<<unquote(c1)::8, unquote(c2)::8, rest::binary>>, %{acc: acc} = state) do
      {token_out(%{state | acc: acc}) ++ token_out(unquote(op), token_start!(state)),
       {rest, token_start(%{state | p: state.p + 2, acc: []})}}
    end
  end

  defp token_next(<<?-, n::8, rest::binary>>, state) when is_num(n) do
    consume_integer(rest, %{token_start(state) | p: state.p + 2, acc: [?-, n]})
  end

  defp token_next(<<n::8, rest::binary>>, state) when is_num(n) do
    consume_integer(rest, %{token_start(state) | p: state.p + 1, acc: [n]})
  end

  defp token_next(<<?-, ?., n::8, rest::binary>>, state) when is_num(n) do
    consume_float(rest, %{token_start(state) | p: state.p + 3, acc: [?-, ?., n]})
  end

  defp token_next(<<?-, n::8, ?., rest::binary>>, state) when is_num(n) do
    consume_float(rest, %{token_start(state) | p: state.p + 3, acc: [?-, n, ?.]})
  end

  defp token_next(<<?., n::8, rest::binary>>, state) when is_num(n) do
    consume_float(rest, %{token_start(state) | p: state.p + 2, acc: [?., n]})
  end

  defp token_next(<<c::8, rest::binary>>, state) when c in @non_ident do
    {
      token_out(state) ++ token_out(String.to_atom(<<c::8>>), token_start(%{state | acc: []})),
      {rest, token_start(%{state | p: state.p + 1, acc: []})}
    }
  end

  defp token_next(<<c::utf8, rest::binary>>, %{acc: []} = state) do
    consume_identifier(rest, %{
      token_start(state)
      | p: state.p + String.length(<<c::utf8>>),
        acc: [<<c::utf8>>]
    })
  end

  defp consume_string(<<?', ?', rest::binary>>, %{s: ?'} = state) do
    consume_string(rest, %{state | acc: [state.acc, ?'], p: state.p + 2})
  end

  defp consume_string(<<?', rest::binary>>, %{s: ?'} = state) do
    string = IO.iodata_to_binary(state.acc)

    {token_out(
       :string,
       string,
       IO.iodata_to_binary([?', :binary.replace(string, "'", "''"), ?']),
       state
     ), {rest, token_start(%{state | p: state.p + 1, s: nil, acc: []})}}
  end

  defp consume_string(stmt, %{s: d} = state) do
    case stmt do
      <<^d::binary-size(byte_size(d)), rest::binary>> ->
        string = IO.iodata_to_binary(state.acc)

        {token_out(:string, string, d <> string <> d, state),
         {rest, %{state | p: state.p + String.length(d), s: nil, acc: []}}}

      <<c::utf8, rest::binary>> ->
        consume_string(rest, %{
          state
          | p: state.p + String.length(<<c::utf8>>),
            acc: [state.acc, <<c::utf8>>]
        })
    end
  end

  defp consume_delimiter(<<?$, rest::binary>>, state) do
    delim = IO.iodata_to_binary([state.s, ?$])
    consume_string(rest, %{state | p: state.p + 1, s: delim})
  end

  defp consume_delimiter(<<c::8, rest::binary>>, state) when is_alpha(c) or is_num(c) do
    consume_delimiter(rest, %{state | p: state.p + 1, s: [state.s, c]})
  end

  defp consume_quoted_identifier(<<?", ?", rest::binary>>, state) do
    consume_quoted_identifier(rest, %{state | p: state.p + 2, acc: [state.acc, ?", ?"]})
  end

  defp consume_quoted_identifier(<<?", rest::binary>>, state) do
    # consume_quoted_identifier(rest, %{state | p: state.p + 2, acc: [state.acc, ?", ?"]})
    ident = IO.iodata_to_binary(state.acc)

    {token_out(:quoted_identifier, ident, "\"" <> ident <> "\"", state),
     {rest, token_start(%{state | p: state.p + 1, acc: []})}}
  end

  defp consume_quoted_identifier(<<c::utf8, rest::binary>>, state) do
    consume_quoted_identifier(rest, %{
      state
      | p: state.p + String.length(<<c::utf8>>),
        acc: [state.acc, <<c::utf8>>]
    })
  end

  defp consume_identifier(<<>>, state) do
    {token_out(state), {:halt, state}}
  end

  defp consume_identifier(<<?;, _rest::binary>>, state) do
    {token_out(state), {:halt, state}}
  end

  defp consume_identifier(<<c::8, _::binary>> = rest, state) when c in @non_ident do
    {token_out(state), {rest, token_start(%{state | acc: []})}}
  end

  for eol <- @line_endings do
    defp consume_identifier(unquote(eol) <> rest, state) do
      {token_out(state), {rest, newline(token_start(%{state | acc: []}))}}
    end
  end

  defp consume_identifier(<<c::8, rest::binary>>, state) when c in @whitespace do
    {token_out(state), {rest, %{token_start(%{state | acc: []}) | p: state.p + 1}}}
  end

  defp consume_identifier(<<c::utf8, rest::binary>>, state) do
    consume_identifier(rest, %{
      state
      | p: state.p + String.length(<<c::utf8>>),
        acc: [state.acc, <<c::utf8>>]
    })
  end

  defp consume_integer(<<n::8, rest::binary>>, state) when is_num(n) do
    consume_integer(rest, %{state | p: state.p + 1, acc: [state.acc, n]})
  end

  defp consume_integer(<<?., rest::binary>>, state) do
    consume_float(rest, %{state | p: state.p + 1, acc: [state.acc, ?.]})
  end

  defp consume_integer(rest, state) do
    src = state.acc |> IO.iodata_to_binary()

    {token_out(
       :integer,
       String.to_integer(src),
       src,
       state
     ), {rest, token_start(%{state | acc: []})}}
  end

  defp consume_float(<<n::8, rest::binary>>, state) when is_num(n) do
    consume_float(rest, %{state | p: state.p + 1, acc: [state.acc, n]})
  end

  defp consume_float(rest, state) do
    src = state.acc |> IO.iodata_to_binary()

    # output floats as strings to avoid rounding errors etc
    {token_out(
       :float,
       src,
       src,
       state
     ), {rest, token_start(%{state | acc: []})}}
  end

  for eol <- @line_endings do
    defp consume_comment(unquote(eol) <> rest, state) do
      token_next(rest, newline(state))
    end
  end

  defp consume_comment(<<c::utf8, rest::binary>>, state) do
    consume_comment(rest, %{state | p: state.p + String.length(<<c::utf8>>)})
  end
end
