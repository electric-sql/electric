defmodule Electric.Postgres.Proxy.ParserTest do
  use ExUnit.Case, async: true

  alias Electric.Postgres.Proxy.Parser

  @whitespace [" ", "\n", "\t"]
  describe "tag matching" do
    def all_case(keyword) do
      keyword
      |> String.graphemes()
      |> Enum.map(fn char -> [String.downcase(char), String.upcase(char)] end)
      |> case_chars()
      |> Enum.shuffle()
      |> then(fn words ->
        if length(words) > 8 do
          Enum.take(words, 8)
        else
          words
        end
      end)
    end

    defp case_chars([]), do: [""]

    defp case_chars([[_, _] = char | rest]) do
      for c <- char, r <- case_chars(rest), do: c <> r
    end

    def test_action(cmd, action) do
      for t <- all_case("table"), s <- [" ", "\n", "\t"] do
        cmd = Enum.join([cmd, " ", t, s, "name"])

        case action do
          :create ->
            refute Parser.capture?(cmd)

          a ->
            assert {true, {^a, "table"}} = Parser.capture?(cmd)
        end
      end

      for i <- all_case("index"), s <- @whitespace do
        cmd = Enum.join([cmd, " ", i, s, "name"])

        case action do
          :alter ->
            assert false == Parser.capture?(cmd)

          _ ->
            assert {true, {^action, "index"}} = Parser.capture?(cmd)
        end
      end
    end

    test "all_case/1" do
      assert all_case("do") |> Enum.sort() == Enum.sort(["do", "dO", "Do", "DO"])
    end

    test "CREATE ..." do
      for c <- all_case("create") do
        test_action(c, :create)
      end
    end

    test "ALTER ..." do
      for c <- all_case("alter") do
        test_action(c, :alter)
      end
    end

    test "DROP ..." do
      for c <- all_case("drop") do
        test_action(c, :drop)
      end
    end

    test "BEGIN" do
      for c <- all_case("begin") do
        assert {true, :begin} = Parser.capture?(c)
      end
    end

    test "COMMIT" do
      for c <- all_case("commit") do
        assert {true, :commit} = Parser.capture?(c)
      end
    end
  end

  describe "DDLX statements" do
    alias Electric.DDLX.Command

    test "ELECTRIC GRANT" do
      for e <- all_case("electric"),
          s1 <- @whitespace,
          g <- all_case("grant") do
        assert {true, {:electric, [%Command.Grant{}]}} =
                 Parser.capture?(IO.iodata_to_binary([e, s1, g, " UPDATE ON table TO 'someone'"]))
      end
    end

    test "ELECTRIC REVOKE" do
      for e <- all_case("electric"),
          s1 <- @whitespace,
          g <- all_case("revoke") do
        assert {true, {:electric, [%Command.Revoke{}]}} =
                 Parser.capture?(
                   IO.iodata_to_binary([e, s1, g, " UPDATE ON table FROM 'someone'"])
                 )
      end
    end

    test "ELECTRIC INVALID" do
      for e <- all_case("electric"),
          s1 <- @whitespace,
          g <- all_case("revoke") do
        assert {true, {:electric, %Command.Error{}}} =
                 Parser.capture?(IO.iodata_to_binary([e, s1, g, " JUNK ON table TO 'someone'"]))
      end
    end
  end

  describe "table_name/1" do
    test "ALTER TABLE" do
      assert {:ok, {"public", "fish"}} =
               Parser.table_name("ALTER TABLE fish ADD COLUMN door int8")

      assert {:ok, {"other", "fish"}} =
               Parser.table_name("ALTER TABLE other.fish ADD COLUMN door int8")

      assert {:ok, {"other", "fish"}} =
               Parser.table_name("ALTER TABLE fish ADD COLUMN door int8", default_schema: "other")

      assert {:ok, {"some other", "flying fish"}} =
               Parser.table_name(~s[ALTER TABLE "some other"."flying fish" ADD COLUMN door int8],
                 default_schema: "other"
               )

      assert {:ok, {"other", "flying fish"}} =
               Parser.table_name(~s[ALTER TABLE "flying fish" ADD COLUMN door int8],
                 default_schema: "other"
               )
    end

    test "INSERT" do
      assert {:ok, {"public", "fish"}} =
               Parser.table_name("INSERT INTO fish (id, value) VALUES ('1', 'content')")

      assert {:ok, {"other", "fish"}} =
               Parser.table_name("INSERT INTO other.fish (id, value) VALUES ('1', 'content')")

      assert {:ok, {"other", "fish"}} =
               Parser.table_name("INSERT INTO fish (id, value) VALUES ('1', 'content')",
                 default_schema: "other"
               )
    end

    test "CALL electric.electrify(..)" do
      assert {:ok, {"public", "fish"}} =
               Parser.table_name("CALL electric.electrify('public.fish')")

      assert {:ok, {"public", "fish"}} =
               Parser.table_name("CALL electric.electrify('fish')")

      assert {:ok, {"other", "fish"}} =
               Parser.table_name("CALL electric.electrify('other.fish')")

      assert {:ok, {"other", "fish"}} =
               Parser.table_name("CALL electric.electrify('other', 'fish')")
    end
  end

  describe "column_map/1" do
    test "INSERT" do
      assert {:ok, %{"id" => 0, "value" => 1, "tree" => 2}} =
               Parser.column_map(
                 "INSERT INTO fish (id, value, tree) VALUES ('1', 'content', 'leaf')"
               )
    end

    test "DELETE" do
      assert {:error, "Not an INSERT statement" <> _} = Parser.column_map("DELETE FROM fish")
    end
  end
end
