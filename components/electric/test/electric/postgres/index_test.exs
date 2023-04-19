defmodule Electric.Postgres.IndexTest do
  use Electric.Postgres.Case, async: true
  use ExUnitProperties

  alias Electric.Postgres.SQLGenerator

  @table_setup """
  CREATE TABLE t1 (c1 int, c2 int, c3 int);
  CREATE TABLE t2 (c4 int, c2 int, c3 int);
  """

  def assert_migration(tests, opts \\ []) do
    setup_sql = Keyword.get(opts, :setup, "")
    table_name = Keyword.get(opts, :table, "t1")

    for {sql, expected_index} <- tests do
      cmds = parse(@table_setup <> setup_sql <> sql)
      schema = Schema.update(Schema.new(), cmds)

      assert_valid_schema(schema)

      assert {:ok, table} = Schema.fetch_table(schema, table_name)
      assert %{indexes: [index]} = table
      assert index == expected_index
    end
  end

  describe "CREATE INDEX" do
    test "ON table" do
      [
        {"CREATE INDEX ON t1 (c1, c2)",
         %Proto.Index{
           columns: [
             %Proto.Index.Column{name: "c1", nulls_ordering: :LAST, ordering: :ASC},
             %Proto.Index.Column{name: "c2", nulls_ordering: :LAST, ordering: :ASC}
           ],
           name: "t1_c1_c2_idx",
           table: %Proto.RangeVar{name: "t1"},
           unique: false,
           using: "btree",
           including: []
         }},
        {"CREATE INDEX ON t1 (c2 DESC NULLS FIRST)",
         %Proto.Index{
           columns: [
             %Proto.Index.Column{name: "c2", nulls_ordering: :FIRST, ordering: :DESC}
           ],
           name: "t1_c2_idx",
           table: %Proto.RangeVar{alias: nil, name: "t1", schema: nil},
           unique: false,
           using: "btree",
           including: []
         }},
        {"CREATE INDEX ON t1 (c2 COLLATE \"de_DE\")",
         %Proto.Index{
           columns: [
             %Proto.Index.Column{
               collation: "de_DE",
               name: "c2",
               nulls_ordering: :LAST,
               ordering: :ASC
             }
           ],
           name: "t1_c2_idx",
           table: %Proto.RangeVar{name: "t1"},
           unique: false,
           using: "btree",
           including: []
         }},
        {"CREATE INDEX ON t1 ((lower(c3)) ASC NULLS LAST)",
         %Proto.Index{
           columns: [
             %Proto.Index.Column{
               name: nil,
               nulls_ordering: :LAST,
               ordering: :ASC,
               expr: %Proto.Expression{
                 expr:
                   {:function,
                    %Proto.Expression.Function{
                      name: "lower",
                      args: [
                        %Proto.Expression{
                          expr: {:col_ref, %Proto.Expression.ColumnRef{name: "c3"}}
                        }
                      ]
                    }}
               }
             }
           ],
           name: "t1_idx",
           table: %Proto.RangeVar{alias: nil, name: "t1", schema: nil},
           unique: false,
           using: "btree",
           where: nil,
           including: []
         }}
      ]
      |> assert_migration()
    end

    test "ON table WHERE predicate" do
      [
        {"CREATE INDEX ON t1 (c1, c2) WHERE c1 > 10 AND c2 < 100",
         %Proto.Index{
           columns: [
             %Proto.Index.Column{name: "c1", nulls_ordering: :LAST, ordering: :ASC},
             %Proto.Index.Column{name: "c2", nulls_ordering: :LAST, ordering: :ASC}
           ],
           name: "t1_c1_c2_idx",
           table: %Proto.RangeVar{name: "t1"},
           unique: false,
           using: "btree",
           where: %Proto.Expression{
             expr:
               {:bool_expr,
                %Proto.Expression.BoolExpr{
                  op: :AND,
                  args: [
                    %Proto.Expression{
                      expr:
                        {:aexpr,
                         %Proto.Expression.AExpr{
                           name: ">",
                           left: %Proto.Expression{
                             expr: {:col_ref, %Proto.Expression.ColumnRef{name: "c1"}}
                           },
                           right: %Proto.Expression{
                             expr:
                               {:const,
                                %Proto.Expression.Const{
                                  value: %Proto.Expression.Value{type: :INTEGER, value: "10"}
                                }}
                           }
                         }}
                    },
                    %Proto.Expression{
                      expr:
                        {:aexpr,
                         %Proto.Expression.AExpr{
                           name: "<",
                           left: %Proto.Expression{
                             expr: {:col_ref, %Proto.Expression.ColumnRef{name: "c2"}}
                           },
                           right: %Proto.Expression{
                             expr:
                               {:const,
                                %Proto.Expression.Const{
                                  value: %Proto.Expression.Value{type: :INTEGER, value: "100"}
                                }}
                           }
                         }}
                    }
                  ]
                }}
           },
           including: []
         }}
      ]
      |> assert_migration()
    end

    test "UNIQUE CONCURRENTLY IF NOT EXISTS USING" do
      [
        {"CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS myindex ON ONLY t1 USING GIST (c1, c2)",
         %Proto.Index{
           columns: [
             %Proto.Index.Column{
               collation: nil,
               name: "c1",
               nulls_ordering: :LAST,
               ordering: :ASC,
               expr: nil
             },
             %Proto.Index.Column{
               collation: nil,
               name: "c2",
               nulls_ordering: :LAST,
               ordering: :ASC,
               expr: nil
             }
           ],
           name: "myindex",
           table: %Proto.RangeVar{alias: nil, name: "t1", schema: nil},
           unique: true,
           using: "gist",
           where: nil,
           including: []
         }}
      ]
      |> assert_migration()
    end

    test "INCLUDING" do
      [
        {
          "CREATE INDEX myindex ON t1 (c1) INCLUDE (c2 ASC, c3 NULLS FIRST)",
          %Proto.Index{
            columns: [
              %Proto.Index.Column{name: "c1", nulls_ordering: :LAST, ordering: :ASC}
            ],
            name: "myindex",
            table: %Proto.RangeVar{name: "t1"},
            unique: false,
            using: "btree",
            including: ["c2", "c3"]
          }
        }
      ]
      |> assert_migration()
    end

    property "generated" do
      check all(sql <- SQLGenerator.Index.create_index(table_name: "t1")) do
        assert cmds = parse(@table_setup <> sql)
        schema = Schema.update(Schema.new(), cmds)
        assert_valid_schema(schema)
      end
    end
  end

  # https://www.postgresql.org/docs/14/sql-alterindex.html
  describe "ALTER INDEX" do
    @create_index "CREATE INDEX name ON t1 (c1, c2);"

    test "ALTER INDEX name RENAME TO new_name" do
      [
        {
          "ALTER INDEX name RENAME TO new_name",
          %Proto.Index{
            columns: [
              %Proto.Index.Column{name: "c1"},
              %Proto.Index.Column{name: "c2"}
            ],
            name: "new_name",
            table: %Proto.RangeVar{name: "t1"},
            unique: false,
            using: "btree",
            including: []
          }
        }
      ]
      |> assert_migration(setup: @create_index)
    end

    test "ALTER INDEX myschema.name RENAME TO otherschema.new_name" do
      [
        {
          "ALTER INDEX myschema.name RENAME TO new_name",
          %Proto.Index{
            columns: [
              %Proto.Index.Column{name: "c1"},
              %Proto.Index.Column{name: "c2"}
            ],
            name: "new_name",
            table: %Proto.RangeVar{name: "t1", schema: "myschema"},
            unique: false,
            using: "btree",
            including: []
          }
        }
      ]
      |> assert_migration(
        setup:
          "CREATE TABLE myschema.t1 (c1 int, c2 int);\nCREATE INDEX name ON myschema.t1 (c1, c2);",
        table: ["myschema", "t1"]
      )
    end

    ## replacing with no-ops
    ## ALTER INDEX [ IF EXISTS ] name SET TABLESPACE tablespace_name
    ## ALTER INDEX name ATTACH PARTITION index_name
    ## ALTER INDEX name [ NO ] DEPENDS ON EXTENSION extension_name
    ## ALTER INDEX [ IF EXISTS ] name SET ( storage_parameter [= value] [, ... ] )
    ## ALTER INDEX [ IF EXISTS ] name RESET ( storage_parameter [, ... ] )
    ## ALTER INDEX [ IF EXISTS ] name ALTER [ COLUMN ] column_number SET STATISTICS integer
    ## ALTER INDEX ALL IN TABLESPACE name [ OWNED BY role_name [, ... ] ] SET TABLESPACE new_tablespace [ NOWAIT ]
  end
end
