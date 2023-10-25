defmodule Electric.DDLX.Parse.Macros do
  @doc """
  Produces a function head that matches a string in a case insensitive way.

  E.g.

       defkeyword :in?, "IN" do
          :ok
       end

  produces the code:

       def in?(<<c0::8, c1::8>> = stmt) when c0 in [?i, ?I] and c1 in [?n, ?N] do
         :ok
       end
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
