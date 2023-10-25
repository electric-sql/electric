defmodule Electric.DDLX.Parse.Tokenizer.Tokens do
  import Electric.DDLX.Parse.Macros

  deftoken(:token, "ALL", [], do: :all)
  deftoken(:token, "ALTER", [], do: :alter)
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
  deftoken(:token, "NULL", [], do: :null)
  deftoken(:token, "ON", [], do: :on)
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

defmodule Electric.DDLX.Parse.Tokenizer do
  alias Electric.DDLX.Parse.Tokenizer.Tokens

  defguardp not_quoted(state) when not state.sq and not state.dq
  defguardp is_quoted(state) when state.sq or state.dq
  defguardp is_squoted(state) when state.sq
  defguardp is_dquoted(state) when state.dq
  defguardp is_alpha(char) when char in ?A..?Z or char in ?a..?z or char in [?_]

  @whitespace [?\s, ?\n, ?\r, ?\n, ?\t]
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
    [{token, {1, state.k, nil}}]
  end

  defp token_out(token, value, state) when is_atom(token) do
    token_out(token, value, nil, state)
  end

  defp token_out(token, value, source, state) when is_atom(token) do
    [{token, {1, state.k, source}, value}]
  end

  defp token_start(%{acc: []} = state) do
    %{state | k: state.p}
  end

  defp token_start(state) do
    state
  end

  defp token_next({:halt, state}), do: {:halt, state}
  defp token_next({str, state}), do: token_next(str, state)

  defp token_next(<<>>, state) do
    {token_out(state), {:halt, state}}
  end

  defp token_next(<<?", rest::binary>>, state) when not_quoted(state) do
    {
      token_out(state) ++ token_out(:"\"", state),
      {rest, %{token_start(%{state | p: state.p + 1}) | dq: true, acc: []}}
    }
  end

  defp token_next(<<?', rest::binary>>, state) when not_quoted(state) do
    consume_string(rest, %{token_start(state) | s: ?', p: state.p + 1})
  end

  defp token_next(<<?$, rest::binary>>, state) when not_quoted(state) do
    consume_delimiter(
      rest,
      {rest, %{state | p: state.p + 1, acc: [state.acc, ?$]}},
      %{token_start(state) | p: state.p + 1, s: [?$]}
    )
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

  defp token_next(<<s::8, rest::binary>>, state) when s in @whitespace do
    {token_out(state), {rest, %{token_start(%{state | acc: []}) | p: state.p + 1}}}
  end

  defp token_next(<<";", _rest::binary>>, %{acc: acc} = state) do
    {token_out(state), {:halt, %{state | p: state.p + 1, acc: []}}}
  end

  defp token_next(<<c::8, rest::binary>>, %{acc: []} = state) when is_alpha(c) do
    token_next(rest, %{state | k: state.p, p: state.p + 1, acc: [c]})
  end

  defp token_next(<<c::8, rest::binary>>, %{acc: acc} = state) when is_alpha(c) do
    token_next(rest, %{state | p: state.p + 1, acc: [acc, c]})
  end

  defp token_next(<<?., rest::binary>>, state) do
    {
      token_out(state) ++ token_out(:., token_start(%{state | acc: []})),
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

  defp token_next(<<c::utf8, rest::binary>>, %{acc: acc} = state) do
    token_next(rest, %{state | p: state.p + String.length(<<c::utf8>>), acc: [acc, <<c::utf8>>]})
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

  defp consume_string(<<c::utf8, rest::binary>>, state) do
    consume_string(rest, %{
      state
      | p: state.p + byte_size(<<c::utf8>>),
        acc: [state.acc, <<c::utf8>>]
    })
  end

  defp consume_delimiter(<<?$, rest::binary>>, _restore, state) do
    delim = IO.iodata_to_binary([state.s, ?$])
    consume_string(rest, %{state | p: state.p + 1, s: delim})
  end

  defp consume_delimiter(<<c::8, rest::binary>>, restore, state) when is_alpha(c) do
    consume_delimiter(rest, restore, %{state | p: state.p + 1, s: [state.s, c]})
  end

  # stop trying to find the end of the delimiter if we hit any non-alpha char and 
  # use the restore state to resume where we were
  defp consume_delimiter(_, {rest, state}, _state) do
    token_next(rest, state)
  end
end
