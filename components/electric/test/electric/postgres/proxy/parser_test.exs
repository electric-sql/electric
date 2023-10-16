defmodule Electric.Postgres.Proxy.ParserTest do
  use ExUnit.Case, async: true
  use ExUnitProperties

  alias Electric.Postgres.Proxy.Parser
  alias PgProtocol.Message, as: M

  describe "table_name/1" do
    test "ALTER TABLE" do
      assert {:table, {"public", "fish"}} =
               Parser.table_name("ALTER TABLE fish ADD COLUMN door int8")

      assert {:table, {"other", "fish"}} =
               Parser.table_name("ALTER TABLE other.fish ADD COLUMN door int8")

      assert {:table, {"other", "fish"}} =
               Parser.table_name("ALTER TABLE fish ADD COLUMN door int8", default_schema: "other")

      assert {:table, {"some other", "flying fish"}} =
               Parser.table_name(~s[ALTER TABLE "some other"."flying fish" ADD COLUMN door int8],
                 default_schema: "other"
               )

      assert {:table, {"other", "flying fish"}} =
               Parser.table_name(~s[ALTER TABLE "flying fish" ADD COLUMN door int8],
                 default_schema: "other"
               )
    end

    test "INSERT" do
      assert {:table, {"public", "fish"}} =
               Parser.table_name("INSERT INTO fish (id, value) VALUES ('1', 'content')")

      assert {:table, {"other", "fish"}} =
               Parser.table_name("INSERT INTO other.fish (id, value) VALUES ('1', 'content')")

      assert {:table, {"other", "fish"}} =
               Parser.table_name("INSERT INTO fish (id, value) VALUES ('1', 'content')",
                 default_schema: "other"
               )
    end

    test "CALL electric.electrify(..)" do
      assert {:table, {"public", "fish"}} =
               Parser.table_name("CALL electric.electrify('public.fish')")

      assert {:table, {"public", "fish"}} =
               Parser.table_name("CALL electric.electrify('fish')")

      assert {:table, {"other", "fish"}} =
               Parser.table_name("CALL electric.electrify('other.fish')")

      assert {:table, {"other", "fish"}} =
               Parser.table_name("CALL electric.electrify('other', 'fish')")
    end
  end

  describe "column_map/1" do
    test "INSERT" do
      assert [stmt] =
               Electric.Postgres.parse!(
                 "INSERT INTO fish (id, value, tree) VALUES ('1', 'content', 'leaf')"
               )

      assert {:ok, %{"id" => 0, "value" => 1, "tree" => 2}} =
               Electric.Postgres.Proxy.QueryAnalyser.Impl.column_map(stmt)
    end
  end

  describe "is_electric_keyword?/1" do
    test "is case insensitive" do
      values = ~w(electric ELECTRIC ElEcTRiC)

      for v <- values do
        assert Parser.is_electric_keyword?(v)
      end
    end

    test "matches with trailing stuff" do
      assert Parser.is_electric_keyword?("electric raingoes")
    end

    test "only matches 'electric'" do
      values = ~w(scalectric LECTRIC ElEcTRi)

      for v <- values do
        refute Parser.is_electric_keyword?(v)
      end
    end
  end

  def simple(sql), do: %M.Query{query: sql}
  def extended(sql, attrs \\ []), do: struct(M.Parse, Keyword.put(attrs, :query, sql))

  describe "parse/1" do
    test "pg-syntax" do
      assert {:ok,
              [
                {%M.Query{query: "ALTER TABLE monkey ADD tail int2 NOT NULL"},
                 %PgQuery.AlterTableStmt{}}
              ]} =
               Parser.parse(simple("ALTER TABLE monkey ADD tail int2 NOT NULL;"))

      assert {:ok,
              [
                {%M.Query{query: "ALTER TABLE monkey ADD tail int2 NOT NULL"},
                 %PgQuery.AlterTableStmt{}}
              ]} =
               Parser.parse(simple("ALTER TABLE monkey ADD tail int2 NOT NULL"))

      assert {:ok,
              [
                {%M.Parse{query: "ALTER TABLE monkey ADD tail int2 NOT NULL;"},
                 %PgQuery.AlterTableStmt{}}
              ]} =
               Parser.parse(extended("ALTER TABLE monkey ADD tail int2 NOT NULL;"))
    end

    test "pg-syntax, no trailing semicolon" do
      assert {:ok,
              [
                {%M.Query{query: "ALTER TABLE monkey ADD tail int2 NOT NULL"},
                 %PgQuery.AlterTableStmt{}},
                {%M.Query{query: "ALTER TABLE giraffe ADD neck int2"}, %PgQuery.AlterTableStmt{}}
              ]} =
               Parser.parse(
                 simple(
                   "ALTER TABLE monkey ADD tail int2 NOT NULL; ALTER TABLE giraffe ADD neck int2"
                 )
               )
    end

    test "electric-syntax" do
      assert {:ok, [{%M.Query{query: "CALL electric.__smuggle__" <> _}, %PgQuery.CallStmt{}}]} =
               Parser.parse(simple("ALTER TABLE monkey ENABLE ELECTRIC;"))

      assert {:ok,
              [
                {%M.Query{query: "CALL electric.__smuggle__" <> _}, %PgQuery.CallStmt{}}
              ]} =
               Parser.parse(
                 simple(
                   "ELECTRIC REVOKE UPDATE (status, name) ON truths FROM 'projects:house.admin'"
                 )
               )
    end

    test "mix of pg- and electric-syntax" do
      assert {:ok,
              [
                {%M.Query{query: "BEGIN"}, %PgQuery.TransactionStmt{}},
                {%M.Query{query: "CALL electric.__smuggle__" <> _}, %PgQuery.CallStmt{}},
                {%M.Query{query: "CALL electric.__smuggle__" <> _}, %PgQuery.CallStmt{}},
                {%M.Query{query: "COMMIT"}, %PgQuery.TransactionStmt{}}
              ]} =
               Parser.parse(
                 simple("""
                  BEGIN;
                  ALTER TABLE monkey ENABLE ELECTRIC;
                  ELECTRIC REVOKE UPDATE (status, name) ON truths FROM 'projects:house.admin';
                  COMMIT;
                 """)
               )
    end

    test "DO .. END" do
      # these queries come in as a `DoStmt` with a string node containing the query between the `$$`
      # and unless the language is `SQL` we can't parse it... so just reject it
      query =
        String.trim("""
        DO $$ 
        DECLARE 
          schema_exists BOOLEAN;
        BEGIN
          SELECT EXISTS (
            SELECT 1
            FROM information_schema.schemata
            WHERE schema_name = 'electric'
          ) INTO schema_exists;

          IF schema_exists THEN
            CALL electric.electrify('public."Items"');
          END IF;
        END $$
        """)

      assert {:error, _} = Parser.parse(simple(query))
    end

    test "invalid pg-syntax" do
      assert {:error, _} = Parser.parse(simple("WHAT EXACTLY SHOULD THIS DO?"))
    end

    test "invalid electric-syntax" do
      assert {:error, _} =
               Parser.parse(
                 simple(
                   "ELECTRIC REVOKE CRISPS (status, name) ON truths FROM 'projects:house.admin';"
                 )
               )
    end

    test "invalid mix" do
      assert {:error, _} =
               Parser.parse(
                 simple("""
                  BEGIN;
                  ALTER TABLE monkey ENABLE ELECTRIC;
                  ELECTRIC REVOKE CRISPS (status, name) ON truths FROM 'projects:house.admin';
                  COMMIT;
                 """)
               )
    end
  end

  describe "find_semicolon/2" do
    test "no semicolons in string" do
      s = "ELECTRIC GRANT JUNK ON \"thing.Köln_en$ts\" TO 'projects:house.admin'"
      assert Parser.find_semicolon(s, :forward) - byte_size(s) == 0
      assert Parser.find_semicolon(s, :reverse) - byte_size(s) == 0
    end

    test "semicolon in middle" do
      a = "ELECTRIC GRANT JUNK"
      b = " ON \"t;hing.Köln_en$ts\" TO 'projects;house.admin'"
      s = a <> ";" <> b
      f = Parser.find_semicolon(s, :forward)
      assert binary_part(s, f, 1) == ";"
      assert Parser.find_semicolon(s, :forward) == byte_size(a)

      f = Parser.find_semicolon(s, :reverse)
      assert binary_part(String.reverse(s), f, 1) == ";"
      assert Parser.find_semicolon(s, :reverse) == byte_size(b)
    end

    test "real world" do
      a =
        "CREATE TABLE something (id uuid PRIMARY KEY, value text);\nALTER TABLE something ENABLE "

      b =
        "ELECTRIC;\nCREATE TABLE ignoreme (id uuid PRIMARY KEY);\nALTER TABLE something ADD amount int4 DEFAULT 0, ADD colour varchar;\n"

      f = Parser.find_semicolon(b, :forward)
      assert binary_part(b, f, 1) == ";"

      f = Parser.find_semicolon(a, :reverse)
      assert binary_part(String.reverse(a), f, 1) == ";"
    end
  end
end
