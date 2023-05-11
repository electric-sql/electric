defmodule Electric.Postgres.AlterTableTest do
  use Electric.Postgres.Case, async: true

  @table_setup """
  CREATE TABLE t1 (o1 int, o2 int);
  """

  def oid_loader(type, schema, name) do
    {:ok, Enum.join(["#{type}", schema, name], ".") |> :erlang.phash2(50_000)}
  end

  def schema_update(schema \\ Schema.new(), cmds) do
    Schema.update(schema, cmds, oid_loader: &oid_loader/3)
  end

  def assert_migration(tests, opts \\ []) do
    setup_sql = Keyword.get(opts, :setup, "")
    table_name = Keyword.get(opts, :table, "t1")

    for {sql, expected_table} <- tests do
      cmds = parse(@table_setup <> setup_sql <> sql)
      schema = schema_update(cmds)

      assert_valid_schema(schema)

      assert {:ok, table} = Schema.fetch_table(schema, table_name)
      assert table == expected_table
    end
  end

  # https://www.postgresql.org/docs/current/sql-altertable.html
  describe "ALTER TABLE {ADD | DROP}" do
    test "ADD COLUMN" do
      [
        {
          """
          ALTER TABLE t1 ADD c2 integer DEFAULT 23;
          """,
          %Proto.Table{
            name: %Proto.RangeVar{schema: "public", name: "t1"},
            oid: 48888,
            columns: [
              %Proto.Column{name: "o1", type: %Proto.Column.Type{name: "int4"}},
              %Proto.Column{name: "o2", type: %Proto.Column.Type{name: "int4"}},
              %Proto.Column{
                name: "c2",
                type: %Proto.Column.Type{name: "int4"},
                constraints: [
                  %Proto.Constraint{
                    constraint:
                      {:default,
                       %Proto.Constraint.Default{
                         expr: %Proto.Expression{
                           expr:
                             {:const,
                              %Proto.Expression.Const{
                                value: %Proto.Expression.Value{type: :INTEGER, value: "23"}
                              }}
                         }
                       }}
                  }
                ]
              }
            ]
          }
        },
        {
          """
          ALTER TABLE t1 * ADD IF NOT EXISTS o1 varchar(24);
          """,
          %Proto.Table{
            name: %Proto.RangeVar{schema: "public", name: "t1"},
            oid: 48888,
            columns: [
              %Proto.Column{name: "o1", type: %Proto.Column.Type{name: "int4"}},
              %Proto.Column{name: "o2", type: %Proto.Column.Type{name: "int4"}}
            ]
          }
        },
        {
          """
          ALTER TABLE IF EXISTS t1 * ADD c5 float8, ADD c6 timestamptz;
          """,
          %Proto.Table{
            name: %Proto.RangeVar{schema: "public", name: "t1"},
            oid: 48888,
            columns: [
              %Proto.Column{name: "o1", type: %Proto.Column.Type{name: "int4"}},
              %Proto.Column{name: "o2", type: %Proto.Column.Type{name: "int4"}},
              %Proto.Column{name: "c5", type: %Proto.Column.Type{name: "float8"}},
              %Proto.Column{name: "c6", type: %Proto.Column.Type{name: "timestamptz"}}
            ]
          }
        },
        {
          """
          ALTER TABLE IF EXISTS t4 ADD c5 float8;
          """,
          %Proto.Table{
            name: %Proto.RangeVar{schema: "public", name: "t1"},
            oid: 48888,
            columns: [
              %Proto.Column{name: "o1", type: %Proto.Column.Type{name: "int4"}},
              %Proto.Column{name: "o2", type: %Proto.Column.Type{name: "int4"}}
            ]
          }
        }
      ]
      |> assert_migration()
    end

    test "DROP COLUMN" do
      [
        {
          """
          ALTER TABLE t1 DROP o2;
          """,
          %Proto.Table{
            name: %Proto.RangeVar{schema: "public", name: "t1"},
            oid: 48888,
            columns: [
              %Proto.Column{name: "o1", type: %Proto.Column.Type{name: "int4"}}
            ]
          }
        },
        {
          """
          ALTER TABLE t1 DROP COLUMN IF EXISTS c1;
          """,
          %Proto.Table{
            name: %Proto.RangeVar{schema: "public", name: "t1"},
            oid: 48888,
            columns: [
              %Proto.Column{name: "o1", type: %Proto.Column.Type{name: "int4"}},
              %Proto.Column{name: "o2", type: %Proto.Column.Type{name: "int4"}}
            ]
          }
        },
        {
          """
          ALTER TABLE t1 DROP o1, DROP o2 CASCADE;
          """,
          %Proto.Table{
            name: %Proto.RangeVar{schema: "public", name: "t1"},
            oid: 48888,
            columns: []
          }
        }
      ]
      |> assert_migration()
    end
  end

  describe "ALTER TABLE ALTER COLUMN" do
    test "SET TYPE" do
      [
        {
          """
          ALTER TABLE t1 ALTER COLUMN o1 SET DATA TYPE float4[][];
          """,
          %Proto.Table{
            name: %Proto.RangeVar{schema: "public", name: "t1"},
            oid: 48888,
            columns: [
              %Proto.Column{
                name: "o1",
                type: %Proto.Column.Type{name: "float4", array: [-1, -1]}
              },
              %Proto.Column{name: "o2", type: %Proto.Column.Type{name: "int4"}}
            ]
          }
        },
        {
          """
          ALTER TABLE t1 ALTER COLUMN o1 SET DEFAULT 3;
          """,
          %Proto.Table{
            name: %Proto.RangeVar{schema: "public", name: "t1"},
            oid: 48888,
            columns: [
              %Proto.Column{
                name: "o1",
                type: %Proto.Column.Type{name: "int4"},
                constraints: [
                  %Proto.Constraint{
                    constraint:
                      {:default,
                       %Proto.Constraint.Default{
                         expr: %Proto.Expression{
                           expr:
                             {:const,
                              %Proto.Expression.Const{
                                value: %Proto.Expression.Value{
                                  type: :INTEGER,
                                  value: "3"
                                }
                              }}
                         }
                       }}
                  }
                ]
              },
              %Proto.Column{name: "o2", type: %Proto.Column.Type{name: "int4"}}
            ]
          }
        },
        {
          """
          ALTER TABLE t1 ALTER COLUMN o1 SET DEFAULT current_time;
          """,
          %Proto.Table{
            name: %Proto.RangeVar{schema: "public", name: "t1"},
            oid: 48888,
            columns: [
              %Proto.Column{
                name: "o1",
                type: %Proto.Column.Type{name: "int4"},
                constraints: [
                  %Proto.Constraint{
                    constraint:
                      {:default,
                       %Proto.Constraint.Default{
                         expr: %Proto.Expression{
                           expr:
                             {:vfunction,
                              %Proto.Expression.ValueFunction{
                                name: "CURRENT_TIME",
                                args: []
                              }}
                         }
                       }}
                  }
                ]
              },
              %Proto.Column{name: "o2", type: %Proto.Column.Type{name: "int4"}}
            ]
          }
        },
        {
          """
          ALTER TABLE t1 ALTER o1 DROP DEFAULT;
          """,
          %Proto.Table{
            name: %Proto.RangeVar{schema: "public", name: "t1"},
            oid: 48888,
            columns: [
              %Proto.Column{name: "o1", type: %Proto.Column.Type{name: "int4"}, constraints: []},
              %Proto.Column{name: "o2", type: %Proto.Column.Type{name: "int4"}}
            ]
          }
        },
        {
          """
          ALTER TABLE t1 ALTER o1 SET NOT NULL;
          """,
          %Proto.Table{
            name: %Proto.RangeVar{schema: "public", name: "t1"},
            oid: 48888,
            columns: [
              %Proto.Column{
                name: "o1",
                type: %Proto.Column.Type{name: "int4"},
                constraints: [
                  %Proto.Constraint{constraint: {:not_null, %Proto.Constraint.NotNull{}}}
                ]
              },
              %Proto.Column{name: "o2", type: %Proto.Column.Type{name: "int4"}}
            ]
          }
        },
        {
          """
          ALTER TABLE t1 ALTER o1 SET NOT NULL;
          ALTER TABLE t1 ALTER o1 DROP NOT NULL;
          """,
          %Proto.Table{
            name: %Proto.RangeVar{schema: "public", name: "t1"},
            oid: 48888,
            columns: [
              %Proto.Column{
                name: "o1",
                type: %Proto.Column.Type{name: "int4"},
                constraints: []
              },
              %Proto.Column{name: "o2", type: %Proto.Column.Type{name: "int4"}}
            ]
          }
        }
      ]
      |> assert_migration()
    end

    test "unsupported actions" do
      [
        # generated columns only, which I think includes the new style of
        # autoincrement keys
        {"DropExpression", "DROP EXPRESSION"},
        {"AddIdentity", "ADD GENERATED ALWAYS AS IDENTITY"},
        {"SetIdentity", "SET GENERATED ALWAYS"},
        {"DropIdentity", "DROP IDENTITY"},
        # analyse stats config
        {"SetStatistics", "SET STATISTICS 1"},
        {"SetOptions", "SET ( n_distinct = 0 )"},
        {"ResetOptions", "RESET ( n_distinct )"},
        {"SetStorage", "SET STORAGE MAIN"},
        {"SetCompression", "SET COMPRESSION lz4"}
      ]
      |> Enum.map(fn {_, sql} ->
        {"ALTER TABLE t1 ALTER o1 " <> sql <> ";",
         %Proto.Table{
           name: %Proto.RangeVar{schema: "public", name: "t1"},
           oid: 48888,
           columns: [
             %Proto.Column{name: "o1", type: %Proto.Column.Type{name: "int4"}},
             %Proto.Column{name: "o2", type: %Proto.Column.Type{name: "int4"}}
           ]
         }}
      end)
      |> assert_migration()
    end
  end

  describe "ALTER TABLE [CONSTRAINT | RULE | TRIGGER | etc ]" do
    test "ADD [CONSTRAINT name] CHECK" do
      # mostly just verifying that the constraint parsing stuff from
      # the create table ast is being correctly used
      [
        {"ALTER TABLE t1 ADD CONSTRAINT con1 CHECK (c1 > 0)",
         %Proto.Table{
           name: %Proto.RangeVar{schema: "public", name: "t1"},
           oid: 48888,
           columns: [
             %Proto.Column{name: "o1", type: %Proto.Column.Type{name: "int4"}},
             %Proto.Column{name: "o2", type: %Proto.Column.Type{name: "int4"}}
           ],
           constraints: [
             %Proto.Constraint{
               constraint: {
                 :check,
                 %Proto.Constraint.Check{
                   name: "con1",
                   expr: %Proto.Expression{
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
                                 value: %Proto.Expression.Value{
                                   type: :INTEGER,
                                   value: "0"
                                 }
                               }}
                          }
                        }}
                   },
                   deferrable: false,
                   initdeferred: false
                 }
               }
             }
           ]
         }},
        {"ALTER TABLE t1 ADD CONSTRAINT con2 CHECK (c1 > 0)",
         %Proto.Table{
           name: %Proto.RangeVar{schema: "public", name: "t1"},
           oid: 48888,
           columns: [
             %Proto.Column{name: "o1", type: %Proto.Column.Type{name: "int4"}},
             %Proto.Column{name: "o2", type: %Proto.Column.Type{name: "int4"}}
           ],
           constraints: [
             %Proto.Constraint{
               constraint: {
                 :check,
                 %Proto.Constraint.Check{
                   name: "con2",
                   expr: %Proto.Expression{
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
                                 value: %Proto.Expression.Value{
                                   type: :INTEGER,
                                   value: "0"
                                 }
                               }}
                          }
                        }}
                   },
                   deferrable: false,
                   initdeferred: false
                 }
               }
             }
           ]
         }},
        {"ALTER TABLE t1 ADD CONSTRAINT con3 FOREIGN KEY (c1, c2) REFERENCES t1 (c1, c2) ON DELETE CASCADE",
         %Proto.Table{
           name: %Proto.RangeVar{schema: "public", name: "t1"},
           oid: 48888,
           columns: [
             %Proto.Column{name: "o1", type: %Proto.Column.Type{name: "int4"}},
             %Proto.Column{name: "o2", type: %Proto.Column.Type{name: "int4"}}
           ],
           constraints: [
             %Proto.Constraint{
               constraint: {
                 :foreign,
                 %Proto.Constraint.ForeignKey{
                   name: "con3",
                   deferrable: false,
                   initdeferred: false,
                   on_update: :NO_ACTION,
                   on_delete: :CASCADE,
                   match_type: :SIMPLE,
                   fk_cols: ["c1", "c2"],
                   pk_table: %Proto.RangeVar{schema: "public", name: "t1"},
                   pk_cols: ["c1", "c2"]
                 }
               }
             }
           ]
         }}
      ]
      |> assert_migration()
    end

    # https://www.tutorialspoint.com/sqlite/sqlite_constraints.htm
    # > SQLite supports a limited subset of ALTER TABLE. The ALTER TABLE command in SQLite allows
    # > the user to rename a table or add a new column to an existing table. It is not possible to
    # > rename a column, remove a column, or add or remove constraints from a table.
    test "ADD [CONSTRAINT name] UNIQUE USING INDEX" do
      [
        {"ALTER TABLE t1 ADD CONSTRAINT i1_unique UNIQUE USING INDEX i1",
         %Proto.Table{
           name: %Proto.RangeVar{schema: "public", name: "t1"},
           oid: 48888,
           columns: [
             %Proto.Column{name: "o1", type: %Proto.Column.Type{name: "int4"}, constraints: []},
             %Proto.Column{name: "o2", type: %Proto.Column.Type{name: "int4"}}
           ],
           constraints: [
             %Proto.Constraint{
               constraint:
                 {:unique,
                  %Proto.Constraint.Unique{
                    name: "i1_unique",
                    keys: [],
                    including: [],
                    deferrable: false,
                    initdeferred: false
                  }}
             }
           ]
         }},
        {"ALTER TABLE t1 ADD PRIMARY KEY USING INDEX i2 DEFERRABLE INITIALLY IMMEDIATE",
         %Proto.Table{
           name: %Proto.RangeVar{schema: "public", name: "t1"},
           oid: 48888,
           columns: [
             %Proto.Column{name: "o1", type: %Proto.Column.Type{name: "int4"}, constraints: []},
             %Proto.Column{name: "o2", type: %Proto.Column.Type{name: "int4"}}
           ],
           constraints: [
             %Proto.Constraint{
               constraint:
                 {:primary,
                  %Proto.Constraint.PrimaryKey{
                    name: "i2",
                    keys: [],
                    including: [],
                    deferrable: true,
                    initdeferred: false
                  }}
             }
           ]
         }},
        {"ALTER TABLE t1 ADD CONSTRAINT c2 UNIQUE USING INDEX i3 NOT DEFERRABLE",
         %Proto.Table{
           name: %Proto.RangeVar{schema: "public", name: "t1"},
           oid: 48888,
           columns: [
             %Proto.Column{name: "o1", type: %Proto.Column.Type{name: "int4"}, constraints: []},
             %Proto.Column{name: "o2", type: %Proto.Column.Type{name: "int4"}}
           ],
           constraints: [
             %Proto.Constraint{
               constraint:
                 {:unique,
                  %Proto.Constraint.Unique{
                    name: "c2",
                    keys: [],
                    including: [],
                    deferrable: false,
                    initdeferred: false
                  }}
             }
           ]
         }}
      ]
      |> assert_migration()
    end

    test "ALTER CONSTRAINT name" do
      [
        {"ALTER TABLE t1 ADD CONSTRAINT con1 UNIQUE (o1); ALTER TABLE t1 ALTER CONSTRAINT con1 DEFERRABLE",
         %Proto.Table{
           name: %Proto.RangeVar{schema: "public", name: "t1"},
           oid: 48888,
           columns: [
             %Proto.Column{name: "o1", type: %Proto.Column.Type{name: "int4"}, constraints: []},
             %Proto.Column{name: "o2", type: %Proto.Column.Type{name: "int4"}}
           ],
           constraints: [
             %Proto.Constraint{
               constraint:
                 {:unique,
                  %Proto.Constraint.Unique{
                    name: "con1",
                    keys: ["o1"],
                    including: [],
                    deferrable: true,
                    initdeferred: false
                  }}
             }
           ]
         }},
        {"ALTER TABLE t1 ADD CONSTRAINT con2 UNIQUE (o1) DEFERRABLE INITIALLY DEFERRED; ALTER TABLE t1 ALTER CONSTRAINT con2 NOT DEFERRABLE INITIALLY IMMEDIATE",
         %Proto.Table{
           name: %Proto.RangeVar{schema: "public", name: "t1"},
           oid: 48888,
           columns: [
             %Proto.Column{name: "o1", type: %Proto.Column.Type{name: "int4"}, constraints: []},
             %Proto.Column{name: "o2", type: %Proto.Column.Type{name: "int4"}}
           ],
           constraints: [
             %Proto.Constraint{
               constraint:
                 {:unique,
                  %Proto.Constraint.Unique{
                    name: "con2",
                    keys: ["o1"],
                    including: [],
                    deferrable: false,
                    initdeferred: false
                  }}
             }
           ]
         }},
        {"ALTER TABLE t1 ADD CONSTRAINT con3 UNIQUE (o1); ALTER TABLE t1 ALTER CONSTRAINT con3 DEFERRABLE INITIALLY DEFERRED",
         %Proto.Table{
           name: %Proto.RangeVar{schema: "public", name: "t1"},
           oid: 48888,
           columns: [
             %Proto.Column{name: "o1", type: %Proto.Column.Type{name: "int4"}, constraints: []},
             %Proto.Column{name: "o2", type: %Proto.Column.Type{name: "int4"}}
           ],
           constraints: [
             %Proto.Constraint{
               constraint:
                 {:unique,
                  %Proto.Constraint.Unique{
                    name: "con3",
                    keys: ["o1"],
                    including: [],
                    deferrable: true,
                    initdeferred: true
                  }}
             }
           ]
         }}
      ]
      |> assert_migration()
    end

    test "DROP CONSTRAINT [IF EXISTS] name [RESTRICT | CASCADE]" do
      [
        {"ALTER TABLE t1 DROP CONSTRAINT con1",
         %Proto.Table{
           name: %Proto.RangeVar{schema: "public", name: "t1"},
           oid: 48888,
           columns: [
             %Proto.Column{name: "o1", type: %Proto.Column.Type{name: "int4"}, constraints: []},
             %Proto.Column{name: "o2", type: %Proto.Column.Type{name: "int4"}}
           ],
           constraints: []
         }},
        {"ALTER TABLE t1 DROP CONSTRAINT IF EXISTS con1",
         %Proto.Table{
           name: %Proto.RangeVar{schema: "public", name: "t1"},
           oid: 48888,
           columns: [
             %Proto.Column{name: "o1", type: %Proto.Column.Type{name: "int4"}, constraints: []},
             %Proto.Column{name: "o2", type: %Proto.Column.Type{name: "int4"}}
           ],
           constraints: []
         }},
        {"ALTER TABLE t1 DROP CONSTRAINT con1 RESTRICT",
         %Proto.Table{
           name: %Proto.RangeVar{schema: "public", name: "t1"},
           oid: 48888,
           columns: [
             %Proto.Column{name: "o1", type: %Proto.Column.Type{name: "int4"}, constraints: []},
             %Proto.Column{name: "o2", type: %Proto.Column.Type{name: "int4"}}
           ],
           constraints: []
         }},
        {"ALTER TABLE t1 DROP CONSTRAINT IF EXISTS con1 CASCADE",
         %Proto.Table{
           name: %Proto.RangeVar{schema: "public", name: "t1"},
           oid: 48888,
           columns: [
             %Proto.Column{name: "o1", type: %Proto.Column.Type{name: "int4"}, constraints: []},
             %Proto.Column{name: "o2", type: %Proto.Column.Type{name: "int4"}}
           ],
           constraints: []
         }}
      ]
      |> assert_migration(setup: "ALTER TABLE t1 ADD CONSTRAINT con1 UNIQUE (o1);")
    end

    test "unsupported commands" do
      [
        "ALTER TABLE t1 VALIDATE CONSTRAINT name",
        "ALTER TABLE t1 DISABLE TRIGGER name",
        "ALTER TABLE t1 ENABLE TRIGGER name ",
        "ALTER TABLE t1 ENABLE REPLICA TRIGGER name",
        "ALTER TABLE t1 ENABLE ALWAYS TRIGGER name",
        "ALTER TABLE t1 DISABLE RULE rewrite_rule_name",
        "ALTER TABLE t1 ENABLE RULE rewrite_rule_name",
        "ALTER TABLE t1 ENABLE REPLICA RULE rewrite_rule_name",
        "ALTER TABLE t1 ENABLE ALWAYS RULE rewrite_rule_name",
        "ALTER TABLE t1 DISABLE ROW LEVEL SECURITY",
        "ALTER TABLE t1 ENABLE ROW LEVEL SECURITY",
        "ALTER TABLE t1 FORCE ROW LEVEL SECURITY",
        "ALTER TABLE t1 NO FORCE ROW LEVEL SECURITY",
        "ALTER TABLE t1 CLUSTER ON index_name",
        "ALTER TABLE t1 SET WITHOUT CLUSTER",
        "ALTER TABLE t1 SET WITHOUT OIDS",
        "ALTER TABLE t1 SET TABLESPACE new_tablespace",
        "ALTER TABLE t1 SET UNLOGGED ",
        "ALTER TABLE t1 SET (fill_factor = 69)",
        "ALTER TABLE t1 RESET ( fill_factor )",
        "ALTER TABLE t1 INHERIT parent_table",
        "ALTER TABLE t1 NO INHERIT parent_table",
        "ALTER TABLE t1 OF type_name",
        "ALTER TABLE t1 NOT OF",
        "ALTER TABLE t1 OWNER TO new_owner",
        "ALTER TABLE t1 REPLICA IDENTITY DEFAULT ",
        "ALTER TABLE t1 SET SCHEMA new_schema",
        "ALTER TABLE t1 SET TABLESPACE new_tablespace",
        "ALTER TABLE t1 ATTACH PARTITION partition_name DEFAULT",
        "ALTER TABLE t1 DETACH PARTITION partition_name"
        # "SET ACCESS METHOD new_access_method",
      ]
      |> Enum.map(
        &{&1,
         %Proto.Table{
           name: %Proto.RangeVar{schema: "public", name: "t1"},
           oid: 48888,
           columns: [
             %Proto.Column{name: "o1", type: %Proto.Column.Type{name: "int4"}},
             %Proto.Column{name: "o2", type: %Proto.Column.Type{name: "int4"}}
           ]
         }}
      )
      |> assert_migration()
    end
  end
end
