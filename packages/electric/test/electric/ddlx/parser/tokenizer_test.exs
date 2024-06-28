defmodule Electric.DDLX.Parser.TokenizerTest do
  use ExUnit.Case, async: true

  alias Electric.DDLX.Parser.Tokenizer

  describe "tokens/1" do
    test "string" do
      delims = ~w[' $$ $delim$ $__234987dsdf__$]

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
                     {:ELECTRIC, {1, 0, nil}, _},
                     {:SQLITE, {1, 9, nil}, _},
                     {:string, {1, 16, ^source}, ^s}
                   ],
                   tokens
                 ),
                 "string #{inspect(s)} not matched with delim #{inspect(d)}: #{inspect(tokens)}"
        end
      end

      tokens =
        Tokenizer.tokens("Electric grant updATE ON thing.Köln_en$ts TO 'projects:house.admin'")

      assert [
               {:ELECTRIC, {1, 0, nil}, "Electric"},
               {:GRANT, {1, 9, nil}, "grant"},
               {:UPDATE, {1, 15, nil}, "updATE"},
               {:ON, {1, 22, nil}, "ON"},
               {:unquoted_identifier, {1, 25, nil}, "thing"},
               {:., {1, 30, nil}},
               {:unquoted_identifier, {1, 31, nil}, "Köln_en$ts"},
               {:TO, {1, 42, nil}, "TO"},
               {:string, {1, 45, "'projects:house.admin'"}, "projects:house.admin"}
             ] = tokens
    end

    test "identifiers" do
      tokens =
        Tokenizer.tokens(
          ~s[identifier "quoted identifier" UnquotedIdentifier "Quoted "" Identifier" _my_83_identifier;]
        )

      assert [
               {:unquoted_identifier, {1, 0, nil}, "identifier"},
               {:quoted_identifier, {1, 11, "\"quoted identifier\""}, "quoted identifier"},
               {:unquoted_identifier, {1, 31, nil}, "UnquotedIdentifier"},
               {:quoted_identifier, {1, 50, "\"Quoted \"\" Identifier\""},
                "Quoted \"\" Identifier"},
               {:unquoted_identifier, {1, 73, nil}, "_my_83_identifier"}
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
               {:unquoted_identifier, {1, 46, nil}, "Köln_en$ts"},
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

    test "integers" do
      tokens = Tokenizer.tokens(~s[this > 10 and that < -12001 ])

      assert [
               {:unquoted_identifier, {1, 0, nil}, "this"},
               {:>, {1, 5, nil}},
               {:integer, {1, 7, "10"}, 10},
               {:AND, {1, 10, nil}, "and"},
               {:unquoted_identifier, {1, 14, nil}, "that"},
               {:<, {1, 19, nil}},
               {:integer, {1, 21, "-12001"}, -12001}
             ] = tokens
    end

    test "floats" do
      tokens =
        Tokenizer.tokens(~s[this > 1.10 and that < -12.001 and throw = .01 and door > -.01 ])

      assert [
               {:unquoted_identifier, {1, 0, nil}, "this"},
               {:>, {1, 5, nil}},
               {:float, {1, 7, "1.10"}, "1.10"},
               {:AND, {1, 12, nil}, "and"},
               {:unquoted_identifier, {1, 16, nil}, "that"},
               {:<, {1, 21, nil}},
               {:float, {1, 23, "-12.001"}, "-12.001"},
               {:AND, {1, 31, nil}, "and"},
               {:unquoted_identifier, {1, 35, nil}, "throw"},
               {:=, {1, 41, nil}},
               {:float, {1, 43, ".01"}, ".01"},
               {:AND, {1, 47, nil}, "and"},
               {:unquoted_identifier, {1, 51, nil}, "door"},
               {:>, {1, 56, nil}},
               {:float, {1, 58, "-.01"}, "-.01"}
             ] = tokens
    end

    test "maths" do
      tokens =
        Tokenizer.tokens(~s[((this + 1.10) * 10) / 12])

      assert [
               {:"(", {1, 0, nil}},
               {:"(", {1, 1, nil}},
               {:unquoted_identifier, {1, 2, nil}, "this"},
               {:+, {1, 7, nil}},
               {:float, {1, 9, "1.10"}, "1.10"},
               {:")", {1, 13, nil}},
               {:*, {1, 15, nil}},
               {:integer, {1, 17, "10"}, 10},
               {:")", {1, 19, nil}},
               {:/, {1, 21, nil}},
               {:integer, {1, 23, "12"}, 12}
             ] = tokens
    end

    test "logical operations" do
      tokens =
        Tokenizer.tokens(~s[this IS NOT NULL AND that <= -12.001 OR throw = .01 AND door <> 9])

      assert [
               {:unquoted_identifier, {1, 0, nil}, "this"},
               {:IS, {1, 5, nil}, "IS"},
               {:NOT, {1, 8, nil}, "NOT"},
               {:NULL, {1, 12, nil}, "NULL"},
               {:AND, {1, 17, nil}, "AND"},
               {:unquoted_identifier, {1, 21, nil}, "that"},
               {:<=, {1, 26, nil}},
               {:float, {1, 29, "-12.001"}, "-12.001"},
               {:OR, {1, 37, nil}, "OR"},
               {:unquoted_identifier, {1, 40, nil}, "throw"},
               {:=, {1, 46, nil}},
               {:float, {1, 48, ".01"}, ".01"},
               {:AND, {1, 52, nil}, "AND"},
               {:unquoted_identifier, {1, 56, nil}, "door"},
               {:<>, {1, 61, nil}},
               {:integer, {1, 64, "9"}, 9}
             ] = tokens
    end

    test "comments" do
      src = """
      -- this is my first comment
      ELECTRIC\tASSIGN  -- this is my second comment
        'admin'
        TO
        -- this is my third comment
        application.admin_users.user_id  -- this is my forth comment
        ;
      """

      lines = String.split(src, "\n")
      endings = ["\n", "\r\n", "\r"]

      for ending <- endings do
        stmt = Enum.join(lines, ending)

        tokens = Tokenizer.tokens(stmt)

        assert [
                 {:ELECTRIC, {2, 0, _}, "ELECTRIC"},
                 {:ASSIGN, {2, 9, _}, "ASSIGN"},
                 {:string, {3, 2, _}, "admin"},
                 {:TO, {4, 2, _}, "TO"},
                 {:unquoted_identifier, {6, 2, _}, "application"},
                 {:., {6, _, _}},
                 {:unquoted_identifier, {6, _, _}, "admin_users"},
                 {:., {6, _, _}},
                 {:unquoted_identifier, {6, _, _}, "user_id"}
               ] = tokens
      end
    end
  end
end
