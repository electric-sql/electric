defmodule Electric.DDLX.Parse.TokenizerTest do
  use ExUnit.Case, async: true

  alias Electric.DDLX.Parse.Tokenizer

  describe "tokens/1" do
    test "string" do
      delims = ~w[' $$ $delim$]

      strings = [
        "my string",
        "my ' string"
      ]

      for d <- delims do
        for s <- strings do
          quoted = if(d == "'", do: :binary.replace(s, "'", "''", [:global]), else: s)
          source = "#{d}#{quoted}#{d}"
          tokens = Tokenizer.tokens("ELECTRIC SQLITE #{source};")

          assert match?(
                   [
                     {:electric, {1, 0, nil}, _},
                     {:sqlite, {1, 9, nil}, _},
                     {:string, {1, 16, ^source}, ^s}
                   ],
                   tokens
                 ),
                 "string #{inspect(s)} not matched with delim #{inspect(d)}: #{inspect(tokens)}"
        end
      end

      tokens =
        Tokenizer.tokens("ELECTRIC GRANT UPDATE ON thing.Köln_en$ts TO 'projects:house.admin'")

      assert [
               {:electric, {1, 0, nil}, "ELECTRIC"},
               {:grant, {1, 9, nil}, "GRANT"},
               {:update, {1, 15, nil}, "UPDATE"},
               {:on, {1, 22, nil}, "ON"},
               {:unquoted_identifier, {1, 25, nil}, "thing"},
               {:., {1, 30, nil}},
               {:unquoted_identifier, {1, 31, nil}, "köln_en$ts"},
               {:to, {1, 42, nil}, "TO"},
               {:string, {1, 45, "'projects:house.admin'"}, "projects:house.admin"}
             ] = tokens
    end

    test "identifiers" do
      tokens =
        Tokenizer.tokens(
          ~s[identifier "quoted identifier" UnquotedIdentifier "Quoted "" Identifier";]
        )

      assert [
               {:unquoted_identifier, {1, 0, nil}, "identifier"},
               {:quoted_identifier, {1, 11, "\"quoted identifier\""}, "quoted identifier"},
               {:unquoted_identifier, {1, 31, nil}, "unquotedidentifier"},
               {:quoted_identifier, {1, 50, "\"Quoted \"\" Identifier\""},
                "Quoted \"\" Identifier"}
             ] = tokens
    end

    test "non-identifier chars" do
      tokens =
        Tokenizer.tokens(~s["thing"."Köln_en$ts" thing."Köln_en$ts" thing.Köln_en$ts this-that;])

      assert [
               {:quoted_identifier, {1, 0, "\"thing\""}, "thing"},
               {:., {1, 7, nil}},
               {:quoted_identifier, {1, 8, "\"Köln_en$ts\""}, "Köln_en$ts"},
               {:unquoted_identifier, {1, 21, nil}, "thing"},
               {:., {1, 26, nil}},
               {:quoted_identifier, {1, 27, "\"Köln_en$ts\""}, "Köln_en$ts"},
               {:unquoted_identifier, {1, 40, nil}, "thing"},
               {:., {1, 45, nil}},
               {:unquoted_identifier, {1, 46, nil}, "köln_en$ts"},
               {:unquoted_identifier, {1, 57, nil}, "this"},
               {:-, {1, 61, nil}},
               {:unquoted_identifier, {1, 62, nil}, "that"}
             ] = tokens
    end

    test "operators" do
      tokens =
        Tokenizer.tokens(~s[this >= that,   who<>them,  cows != sheep])

      assert [
               {:unquoted_identifier, {1, 0, nil}, "this"},
               {:>=, {1, 5, nil}},
               {:unquoted_identifier, {1, 8, nil}, "that"},
               {:",", {1, 12, nil}},
               {:unquoted_identifier, {1, 16, nil}, "who"},
               {:<>, {1, 19, nil}},
               {:unquoted_identifier, {1, 21, nil}, "them"},
               {:",", {1, 25, nil}},
               {:unquoted_identifier, {1, 28, nil}, "cows"},
               {:!=, {1, 33, nil}},
               {:unquoted_identifier, {1, 36, nil}, "sheep"}
             ] = tokens
    end
  end
end
