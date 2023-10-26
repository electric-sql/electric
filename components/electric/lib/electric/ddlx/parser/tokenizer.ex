defmodule Electric.DDLX.Parser.Tokenizer.Tokens do
  import Electric.DDLX.Parser.Macros

  deftoken(:token, "ALL", [], do: :all)
  deftoken(:token, "ALTER", [], do: :alter)
  deftoken(:token, "AND", [], do: :and)
  deftoken(:token, "ASSIGN", [], do: :assign)
  deftoken(:token, "CHECK", [], do: :check)
  deftoken(:token, "DELETE", [], do: :delete)
  deftoken(:token, "DISABLE", [], do: :disable)
  deftoken(:token, "ELECTRIC", [], do: :electric)
  deftoken(:token, "ENABLE", [], do: :enable)
  deftoken(:token, "FROM", [], do: :from)
  deftoken(:token, "GRANT", [], do: :grant)
  deftoken(:token, "IF", [], do: :if)
  deftoken(:token, "INSERT", [], do: :insert)
  deftoken(:token, "IS", [], do: :is)
  deftoken(:token, "NOT", [], do: :not)
  deftoken(:token, "NULL", [], do: :null)
  deftoken(:token, "ON", [], do: :on)
  deftoken(:token, "OR", [], do: :or)
  deftoken(:token, "PRIVILEGES", [], do: :privileges)
  deftoken(:token, "READ", [], do: :read)
  deftoken(:token, "REVOKE", [], do: :revoke)
  deftoken(:token, "SELECT", [], do: :select)
  deftoken(:token, "SQLITE", [], do: :sqlite)
  deftoken(:token, "TABLE", [], do: :table)
  deftoken(:token, "TO", [], do: :to)
  deftoken(:token, "UNASSIGN", [], do: :unassign)
  deftoken(:token, "UPDATE", [], do: :update)
  deftoken(:token, "USING", [], do: :using)
  deftoken(:token, "WRITE", [], do: :write)
  def token(s), do: s
end

defmodule Electric.DDLX.Parser.Tokenizer do
  alias Electric.DDLX.Parser.Tokenizer.Tokens

  @type position() :: {integer(), integer(), nil | String.t()}
  @type t() :: {atom, position()} | {atom, position(), String.t()}

  @whitespace [?\s, ?\n, ?\r, ?\n, ?\t]
  @non_ident [?., ?,, ?(, ?), ?:, ?=, ?-, ?<, ?>, ?+, ?*, ?/]
  @operators [{?<, ?>}, {?<, ?=}, {?>, ?=}, {?!, ?=}]
  @integers ?0..?9

  defguardp is_alpha(char) when char in ?A..?Z or char in ?a..?z or char in [?_]
  defguardp is_num(char) when char in @integers

  def tokens(str) do
    str
    |> token_stream()
    |> Enum.to_list()
  end

  def token_stream(str) do
    Stream.resource(
      fn -> {str, %{p: 0, k: 0, acc: [], sq: false, dq: false, s: nil, cm: false}} end,
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
        [{keyword, {1, state.k, nil}, s}]

      string when is_binary(string) ->
        [{:unquoted_identifier, {1, state.k, nil}, string}]
    end
  end

  defp token_out(token, state) when is_atom(token) do
    [{token, {1, state.k, nil}}]
  end

  defp token_out(token, value, source, state)
       when is_atom(token) and (is_list(value) or is_binary(value)) do
    [{token, {1, state.k, IO.iodata_to_binary(source)}, IO.iodata_to_binary(value)}]
  end

  defp token_out(token, value, source, state) do
    [{token, {1, state.k, IO.iodata_to_binary(source)}, value}]
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

  defp token_next({:halt, state}), do: {:halt, state}
  defp token_next({str, state}), do: token_next(str, state)

  defp token_next(<<>>, state) do
    {token_out(state), {:halt, state}}
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

  for {c1, c2} <- @operators do
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

  defp consume_delimiter(<<c::8, rest::binary>>, state) when is_alpha(c) do
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
end
