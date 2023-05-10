defmodule Electric.Postgres.SchemaTest do
  use Electric.Postgres.Case, async: true

  def assert_migrations(sqls) do
    Enum.each(sqls, fn {sql, table_ast} ->
      cmds = parse(sql)
      schema = Schema.update(Schema.new(), cmds)
      assert_valid_schema(schema)

      for {table_name, expected_ast} <- table_ast do
        case expected_ast do
          :error ->
            assert :error = Schema.fetch_table(schema, table_name)

          expected_ast ->
            assert {:ok, table_ast} = Schema.fetch_table(schema, table_name)
            assert table_ast == expected_ast
        end
      end
    end)
  end

  describe "same_schema?" do
    @tests [
      {nil, ""},
      {nil, "public"},
      {"public", ""},
      {"public", nil}
    ]
    for {l, r} <- @tests do
      test "same_schema?(#{inspect(l)}, #{inspect(r)})" do
        assert Schema.same_schema?(unquote(l), unquote(r))
      end
    end
  end

  # the pgddl extension sets defaults for tables in separate alter table commands
  # rather than hack this extension, ensure this is manually tested
  test "create table; alter .. set default" do
    ast1 = %Proto.Table{
      name: %Proto.RangeVar{schema: "public", name: "AiSq_XEbXrx"},
      columns: [
        %Proto.Column{
          name: "Rkr_eTvsYB",
          type: %Proto.Column.Type{name: "timestamptz", size: [6]}
        },
        %Proto.Column{
          name: "rTKhvhvVIJ",
          type: %Proto.Column.Type{name: "timestamp", size: [0]},
          constraints:
            Schema.struct_order([
              %Proto.Constraint{constraint: {:not_null, %Proto.Constraint.NotNull{}}},
              %Proto.Constraint{
                constraint:
                  {:default,
                   %Proto.Constraint.Default{
                     expr: %Proto.Expression{
                       expr:
                         {:cast,
                          %Proto.Expression.Cast{
                            arg: %Proto.Expression{
                              expr:
                                {:const,
                                 %Proto.Expression.Const{
                                   value: %Proto.Expression.Value{
                                     type: :STRING,
                                     value: "2000-12-25 23:25:50"
                                   }
                                 }}
                            },
                            type: %Proto.Column.Type{name: "timestamp"}
                          }}
                     }
                   }}
              }
            ])
        }
      ]
    }

    ast2 = %Proto.Table{
      name: %Proto.RangeVar{schema: "public", name: "ejbGPyO"},
      columns: [
        %Proto.Column{
          name: "RGkesnb",
          type: %Proto.Column.Type{name: "date"},
          constraints:
            Schema.struct_order([
              %Proto.Constraint{
                constraint:
                  {:default,
                   %Proto.Constraint.Default{
                     expr: %Proto.Expression{
                       expr:
                         {:vfunction,
                          %Proto.Expression.ValueFunction{name: "CURRENT_DATE", args: []}}
                     }
                   }}
              }
            ])
        }
      ],
      constraints: [
        %Proto.Constraint{
          constraint:
            {:check,
             %Proto.Constraint.Check{
               expr: %Proto.Expression{
                 expr:
                   {:aexpr,
                    %Proto.Expression.AExpr{
                      name: ">",
                      left: %Proto.Expression{
                        expr: {:col_ref, %Proto.Expression.ColumnRef{name: "RGkesnb"}}
                      },
                      right: %Proto.Expression{
                        expr:
                          {:const,
                           %Proto.Expression.Const{
                             value: %Proto.Expression.Value{
                               type: :STRING,
                               value: "2041-07-12"
                             }
                           }}
                      }
                    }}
               },
               name: "RGkesnb_after_date"
             }}
        }
      ]
    }

    [
      {
        """
        CREATE TABLE "AiSq_XEbXrx" (
            "Rkr_eTvsYB" timestamp(6) with time zone,
            "rTKhvhvVIJ" timestamp(0) without time zone NOT NULL DEFAULT '1999-09-19 11:11:11'
        );

        ALTER TABLE "AiSq_XEbXrx" ALTER "rTKhvhvVIJ" SET DEFAULT '2000-12-25 23:25:50'::timestamp without time zone
        """,
        %{"AiSq_XEbXrx" => ast1}
      },
      {
        """
        CREATE TABLE "ejbGPyO" (
            "RGkesnb" date CONSTRAINT "RGkesnb_after_date" CHECK ("RGkesnb" > '2041-07-12')
        );

        ALTER TABLE "ejbGPyO" ALTER "RGkesnb" SET DEFAULT CURRENT_DATE;
        """,
        %{"ejbGPyO" => ast2}
      }
    ]
    |> assert_migrations()
  end

  test "alter table add column" do
    [
      {
        """
        CREATE TABLE "t1" (
            "c1" integer[],
            "c2" char[3][4]
        );
        ALTER TABLE "t1" ADD COLUMN "c3" float4[][6][3] NOT NULL DEFAULT 3.0;
        """,
        %{
          "t1" => %Proto.Table{
            name: %Proto.RangeVar{schema: "public", name: "t1"},
            columns: [
              %Proto.Column{name: "c1", type: %Proto.Column.Type{name: "int4", array: [-1]}},
              %Proto.Column{
                name: "c2",
                type: %Proto.Column.Type{name: "bpchar", array: [3, 4], size: [1]}
              },
              %Proto.Column{
                name: "c3",
                type: %Proto.Column.Type{name: "float4", array: [-1, 6, 3]},
                constraints:
                  Schema.order([
                    %Proto.Constraint{constraint: {:not_null, %Proto.Constraint.NotNull{}}},
                    %Proto.Constraint{
                      constraint:
                        {:default,
                         %Proto.Constraint.Default{
                           expr: %Proto.Expression{
                             expr:
                               {:const,
                                %Proto.Expression.Const{
                                  value: %Proto.Expression.Value{
                                    type: :FLOAT,
                                    value: "3.0"
                                  }
                                }}
                           }
                         }}
                    }
                  ])
              }
            ]
          }
        }
      },
      {
        """
        CREATE TABLE "t2" ("c4" integer, "c5" char);
        ALTER TABLE "t2" ADD COLUMN "c6" uuid PRIMARY KEY;
        """,
        %{
          "t2" => %Proto.Table{
            name: %Proto.RangeVar{schema: "public", name: "t2"},
            columns: [
              %Proto.Column{name: "c4", type: %Proto.Column.Type{name: "int4"}},
              %Proto.Column{name: "c5", type: %Proto.Column.Type{name: "bpchar", size: [1]}},
              %Proto.Column{
                name: "c6",
                type: %Proto.Column.Type{name: "uuid"},
                constraints:
                  Schema.order([
                    %Proto.Constraint{constraint: {:not_null, %Proto.Constraint.NotNull{}}}
                  ])
              }
            ],
            constraints: [
              %Proto.Constraint{
                constraint:
                  {:primary,
                   %Proto.Constraint.PrimaryKey{
                     keys: ["c6"],
                     name: "t2_pkey"
                   }}
              }
            ]
          }
        }
      }
    ]
    |> assert_migrations()
  end

  test "primary key sets not null" do
    ast = %Proto.Table{
      name: %Proto.RangeVar{schema: "public", name: "t1"},
      columns: [
        %Proto.Column{
          name: "oLoyTXvNOFD",
          type: %Proto.Column.Type{name: "int4"},
          constraints:
            Schema.struct_order([
              %Proto.Constraint{constraint: {:not_null, %Proto.Constraint.NotNull{}}},
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
                              value: "5656933"
                            }
                          }}
                     }
                   }}
              }
            ])
        },
        %Proto.Column{name: "aaaaaaaaaaa", type: %Proto.Column.Type{name: "int4"}}
      ],
      constraints: [
        %Proto.Constraint{
          constraint:
            {:primary,
             %Proto.Constraint.PrimaryKey{
               name: "t1_pkey",
               keys: ["oLoyTXvNOFD"],
               including: [],
               deferrable: false,
               initdeferred: false
             }}
        }
      ]
    }

    [
      {
        """
        CREATE TABLE IF NOT EXISTS "t1" (
          "oLoyTXvNOFD" integer PRIMARY KEY DEFAULT 5656933,
          "aaaaaaaaaaa" integer
        );
        """,
        %{"t1" => ast}
      },
      {
        """
        CREATE TABLE IF NOT EXISTS "t1" (
          "oLoyTXvNOFD" integer DEFAULT 5656933,
          "aaaaaaaaaaa" integer,
          PRIMARY KEY ("oLoyTXvNOFD")
        );
        """,
        %{"t1" => ast}
      },
      {
        """
        CREATE TABLE IF NOT EXISTS "t1" (
          "oLoyTXvNOFD" integer DEFAULT 5656933,
          "aaaaaaaaaaa" integer
        );
        ALTER TABLE ONLY "t1"
          ADD CONSTRAINT "t1_pkey" PRIMARY KEY ("oLoyTXvNOFD");
        """,
        %{"t1" => ast}
      }
    ]
    |> assert_migrations()
  end

  test "drop column drops foreign keys" do
    # when you drop.. cascade a column that has foreign keys pointing to it
    # it drops the fk constraint on the dependent table
    [
      {"""
       CREATE TABLE IF NOT EXISTS "a" (
         "a_id" integer PRIMARY KEY,
         "value" integer
       );
       CREATE TABLE IF NOT EXISTS "b" (
         "b_id" integer PRIMARY KEY,
         "ba_id" integer REFERENCES a (a_id)
       );

       ALTER TABLE "a" DROP "a_id" CASCADE;
       """,
       %{
         "a" => %Proto.Table{
           name: %Proto.RangeVar{schema: "public", name: "a"},
           columns: [
             %Proto.Column{name: "value", type: %Proto.Column.Type{name: "int4"}}
           ]
         },
         "b" => %Proto.Table{
           name: %Proto.RangeVar{schema: "public", name: "b"},
           columns: [
             %Proto.Column{
               name: "b_id",
               type: %Proto.Column.Type{name: "int4"},
               constraints: [
                 %Proto.Constraint{constraint: {:not_null, %Proto.Constraint.NotNull{}}}
               ]
             },
             %Proto.Column{name: "ba_id", type: %Proto.Column.Type{name: "int4"}}
           ],
           constraints: [
             %Proto.Constraint{
               constraint:
                 {:primary,
                  %Proto.Constraint.PrimaryKey{
                    name: "b_pkey",
                    keys: ["b_id"],
                    including: [],
                    deferrable: false,
                    initdeferred: false
                  }}
             }
           ]
         }
       }}
    ]
    |> assert_migrations()
  end

  test "drop column drops constraints involving that column" do
    [
      {"""
       CREATE TABLE IF NOT EXISTS "a" (
         "a_1" integer,
         "a_2" integer,
         CONSTRAINT "a_1_check" CHECK ("a_1" > 0),
         CONSTRAINT "a_1_check1" CHECK ("a_1" > "a_2"),
         CONSTRAINT "a_2_check" CHECK ("a_2" < 100)
       );

       ALTER TABLE "a" DROP "a_2" CASCADE;
       """,
       %{
         "a" => %Proto.Table{
           name: %Proto.RangeVar{schema: "public", name: "a"},
           columns: [
             %Proto.Column{name: "a_1", type: %Proto.Column.Type{name: "int4"}}
           ],
           constraints: [
             %Proto.Constraint{
               constraint:
                 {:check,
                  %Proto.Constraint.Check{
                    expr: %Proto.Expression{
                      expr:
                        {:aexpr,
                         %Proto.Expression.AExpr{
                           name: ">",
                           left: %Proto.Expression{
                             expr: {:col_ref, %Proto.Expression.ColumnRef{name: "a_1"}}
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
                    name: "a_1_check"
                  }}
             }
           ]
         }
       }},
      {"""
       CREATE TABLE IF NOT EXISTS "a" (
         "b_1" integer,
         "b_2" integer,
         CONSTRAINT "b_1_unique" UNIQUE ("b_1") INCLUDE ("b_2")
       );

       ALTER TABLE "a" DROP "b_2" CASCADE;
       """,
       %{
         "a" => %Proto.Table{
           name: %Proto.RangeVar{schema: "public", name: "a"},
           columns: [
             %Proto.Column{name: "b_1", type: %Proto.Column.Type{name: "int4"}}
           ]
         }
       }},
      # bit of a mare: to have a fk on a column you need a unique constraint on it
      # so if you drop the unique constraint on the referenced column you also need
      # to drop any fk constraints pointing to it
      {"""
       CREATE TABLE IF NOT EXISTS "a" (
         "a_1" integer,
         "a_2" integer,
         CONSTRAINT "a_1_check" UNIQUE ("a_1") INCLUDE ("a_2")
       );
       CREATE TABLE IF NOT EXISTS "b" (
         "b_1" integer,
         "b_2" integer REFERENCES "a" ("a_1")
       );

       ALTER TABLE "a" DROP "a_2" CASCADE;
       """,
       %{
         "a" => %Proto.Table{
           name: %Proto.RangeVar{schema: "public", name: "a"},
           columns: [%Proto.Column{name: "a_1", type: %Proto.Column.Type{name: "int4"}}]
         },
         "b" => %Proto.Table{
           name: %Proto.RangeVar{schema: "public", name: "b"},
           columns: [
             %Proto.Column{name: "b_1", type: %Proto.Column.Type{name: "int4"}},
             %Proto.Column{name: "b_2", type: %Proto.Column.Type{name: "int4"}}
           ]
         }
       }}
    ]
    |> assert_migrations()
  end

  test "drop unique constraint drops fks requiring that constraint" do
    [
      {"""
       CREATE TABLE IF NOT EXISTS "a" (
         "a_1" integer,
         "a_2" integer,
         CONSTRAINT "a_1_key" UNIQUE ("a_1") INCLUDE ("a_2")
       );
       CREATE TABLE IF NOT EXISTS "b" (
         "b_1" integer,
         "b_2" integer REFERENCES "a" ("a_1")
       );

       ALTER TABLE "a" DROP CONSTRAINT "a_1_key" CASCADE;
       """,
       %{
         "a" => %Proto.Table{
           name: %Proto.RangeVar{schema: "public", name: "a"},
           columns: [
             %Proto.Column{name: "a_1", type: %Proto.Column.Type{name: "int4"}},
             %Proto.Column{name: "a_2", type: %Proto.Column.Type{name: "int4"}}
           ]
         },
         "b" => %Proto.Table{
           name: %Proto.RangeVar{schema: "public", name: "b"},
           columns: [
             %Proto.Column{name: "b_1", type: %Proto.Column.Type{name: "int4"}},
             %Proto.Column{name: "b_2", type: %Proto.Column.Type{name: "int4"}}
           ]
         }
       }}
    ]
    |> assert_migrations()
  end

  test "rename column renames foreign key references" do
    [
      {"""
       CREATE TABLE IF NOT EXISTS "a" (
         "a_id" integer PRIMARY KEY,
         "value" integer
       );
       CREATE TABLE IF NOT EXISTS "b" (
         "b_id" integer PRIMARY KEY,
         "a_id" integer REFERENCES a (a_id)
       );

       ALTER TABLE "a" RENAME "a_id" TO "a_fish";
       """,
       %{
         "a" => %Proto.Table{
           name: %Proto.RangeVar{schema: "public", name: "a"},
           columns: [
             %Proto.Column{
               name: "a_fish",
               type: %Proto.Column.Type{name: "int4"},
               constraints: [
                 %Proto.Constraint{constraint: {:not_null, %Proto.Constraint.NotNull{}}}
               ]
             },
             %Proto.Column{name: "value", type: %Proto.Column.Type{name: "int4"}}
           ],
           constraints: [
             %Proto.Constraint{
               constraint:
                 {:primary,
                  %Proto.Constraint.PrimaryKey{
                    name: "a_pkey",
                    keys: ["a_fish"]
                  }}
             }
           ]
         },
         "b" => %Proto.Table{
           name: %Proto.RangeVar{schema: "public", name: "b"},
           columns: [
             %Proto.Column{
               name: "b_id",
               type: %Proto.Column.Type{name: "int4"},
               constraints: [
                 %Proto.Constraint{constraint: {:not_null, %Proto.Constraint.NotNull{}}}
               ]
             },
             %Proto.Column{name: "a_id", type: %Proto.Column.Type{name: "int4"}}
           ],
           constraints:
             Schema.order([
               %Proto.Constraint{
                 constraint:
                   {:primary,
                    %Proto.Constraint.PrimaryKey{
                      name: "b_pkey",
                      keys: ["b_id"],
                      deferrable: false,
                      initdeferred: false
                    }}
               },
               %Proto.Constraint{
                 constraint:
                   {:foreign,
                    %Proto.Constraint.ForeignKey{
                      name: "b_a_id_fkey",
                      fk_cols: ["a_id"],
                      pk_table: %Proto.RangeVar{schema: "public", name: "a"},
                      pk_cols: ["a_fish"],
                      match_type: :SIMPLE,
                      on_delete: :NO_ACTION,
                      on_update: :NO_ACTION
                    }}
               }
             ])
         }
       }}
    ]
    |> assert_migrations()
  end

  test "rename column renames generated constraint references" do
    [
      {"""
       CREATE TABLE IF NOT EXISTS "a" (
         "c1" integer,
         "c2" integer,
         "g1" integer GENERATED ALWAYS AS ("c1" + "c2") STORED
       );

       ALTER TABLE "a" RENAME "c1" TO "c3";
       """,
       %{
         "a" => %Proto.Table{
           name: %Proto.RangeVar{schema: "public", name: "a"},
           columns: [
             %Proto.Column{name: "c3", type: %Proto.Column.Type{name: "int4"}},
             %Proto.Column{name: "c2", type: %Proto.Column.Type{name: "int4"}},
             %Proto.Column{
               name: "g1",
               type: %Proto.Column.Type{name: "int4"},
               constraints: [
                 %Proto.Constraint{
                   constraint:
                     {:generated,
                      %Proto.Constraint.Generated{
                        when: :ALWAYS,
                        expr: %Proto.Expression{
                          expr:
                            {:aexpr,
                             %Proto.Expression.AExpr{
                               name: "+",
                               left: %Proto.Expression{
                                 expr: {:col_ref, %Proto.Expression.ColumnRef{name: "c3"}}
                               },
                               right: %Proto.Expression{
                                 expr: {:col_ref, %Proto.Expression.ColumnRef{name: "c2"}}
                               }
                             }}
                        }
                      }}
                 }
               ]
             }
           ]
         }
       }}
    ]
    |> assert_migrations()
  end

  test "drop table drops fk constraints" do
    [
      {
        """
        CREATE TABLE IF NOT EXISTS "a" (
          "a_id" integer PRIMARY KEY,
          "value" integer
        );

        CREATE TABLE IF NOT EXISTS "b" (
          "b_id" integer PRIMARY KEY,
          "a_id" integer REFERENCES a (a_id)
        );

        DROP TABLE "a" CASCADE;
        """,
        %{
          "a" => :error,
          "b" => %Proto.Table{
            name: %Proto.RangeVar{schema: "public", name: "b"},
            columns: [
              %Proto.Column{
                name: "b_id",
                type: %Proto.Column.Type{name: "int4"},
                constraints: [
                  %Proto.Constraint{constraint: {:not_null, %Proto.Constraint.NotNull{}}}
                ]
              },
              %Proto.Column{name: "a_id", type: %Proto.Column.Type{name: "int4"}}
            ],
            constraints: [
              %Proto.Constraint{
                constraint:
                  {:primary,
                   %Proto.Constraint.PrimaryKey{
                     name: "b_pkey",
                     keys: ["b_id"],
                     including: [],
                     deferrable: false,
                     initdeferred: false
                   }}
              }
            ]
          }
        }
      },
      {
        """
        CREATE TABLE IF NOT EXISTS "a" (
          "id" integer PRIMARY KEY
        );

        -- even though we're dropping the column that a_id refers to
        -- a_id still has a unique constraint on it, so the fk in c
        -- that refers to it is still valid
        CREATE TABLE IF NOT EXISTS "b" (
          "a_id" integer REFERENCES a (id),
          UNIQUE ("a_id")
        );

        CREATE TABLE IF NOT EXISTS "c" (
          "b_a_id" integer REFERENCES b (a_id)
        );

        DROP TABLE "a" CASCADE;
        """,
        %{
          "a" => :error,
          "b" => %Proto.Table{
            name: %Proto.RangeVar{schema: "public", name: "b"},
            columns: [
              %Proto.Column{name: "a_id", type: %Proto.Column.Type{name: "int4"}}
            ],
            constraints: [
              %Proto.Constraint{
                constraint:
                  {:unique, %Proto.Constraint.Unique{name: "b_a_id_key", keys: ["a_id"]}}
              }
            ]
          },
          "c" => %Proto.Table{
            name: %Proto.RangeVar{schema: "public", name: "c"},
            columns: [
              %Proto.Column{name: "b_a_id", type: %Proto.Column.Type{name: "int4"}}
            ],
            constraints: [
              %Proto.Constraint{
                constraint:
                  {:foreign,
                   %Proto.Constraint.ForeignKey{
                     name: "c_b_a_id_fkey",
                     fk_cols: ["b_a_id"],
                     pk_table: %Proto.RangeVar{schema: "public", name: "b"},
                     pk_cols: ["a_id"]
                   }}
              }
            ]
          }
        }
      },
      {
        """
        CREATE TABLE IF NOT EXISTS "a" (
          "id" integer PRIMARY KEY
        );

        -- even though we're dropping the column that a_id refers to
        -- a_id still has a unique constraint on it, so the fk in c
        -- that refers to it is still valid
        CREATE TABLE IF NOT EXISTS "b" (
          "a_id" integer REFERENCES a (id),
          UNIQUE ("a_id")
        );

        CREATE TABLE IF NOT EXISTS "c" (
          "b_a_id" integer REFERENCES b (a_id)
        );

        DROP TABLE "a" CASCADE;
        ALTER TABLE "b" DROP CONSTRAINT "b_a_id_key" CASCADE;
        """,
        %{
          "a" => :error,
          "b" => %Proto.Table{
            name: %Proto.RangeVar{schema: "public", name: "b"},
            columns: [
              %Proto.Column{name: "a_id", type: %Proto.Column.Type{name: "int4"}}
            ]
          },
          "c" => %Proto.Table{
            name: %Proto.RangeVar{schema: "public", name: "c"},
            columns: [
              %Proto.Column{name: "b_a_id", type: %Proto.Column.Type{name: "int4"}}
            ]
          }
        }
      }
    ]
    |> assert_migrations()
  end

  test "rename table renames foreign key references" do
    [
      {"""
       CREATE TABLE IF NOT EXISTS "a" (
         "a_id" integer PRIMARY KEY,
         "value" integer
       );
       CREATE TABLE IF NOT EXISTS "b" (
         "b_id" integer PRIMARY KEY,
         "a_id" integer REFERENCES a (a_id)
       );

       ALTER TABLE "a" RENAME TO "c";
       """,
       %{
         "c" => %Proto.Table{
           name: %Proto.RangeVar{schema: "public", name: "c"},
           columns: [
             %Proto.Column{
               name: "a_id",
               type: %Proto.Column.Type{name: "int4"},
               constraints: [
                 %Proto.Constraint{constraint: {:not_null, %Proto.Constraint.NotNull{}}}
               ]
             },
             %Proto.Column{name: "value", type: %Proto.Column.Type{name: "int4"}}
           ],
           constraints: [
             %Proto.Constraint{
               constraint:
                 {:primary,
                  %Proto.Constraint.PrimaryKey{
                    name: "a_pkey",
                    keys: ["a_id"]
                  }}
             }
           ]
         },
         "b" => %Proto.Table{
           name: %Proto.RangeVar{schema: "public", name: "b"},
           columns: [
             %Proto.Column{
               name: "b_id",
               type: %Proto.Column.Type{name: "int4"},
               constraints: [
                 %Proto.Constraint{constraint: {:not_null, %Proto.Constraint.NotNull{}}}
               ]
             },
             %Proto.Column{name: "a_id", type: %Proto.Column.Type{name: "int4"}}
           ],
           constraints:
             Schema.order([
               %Proto.Constraint{
                 constraint:
                   {:primary,
                    %Proto.Constraint.PrimaryKey{
                      name: "b_pkey",
                      keys: ["b_id"],
                      deferrable: false,
                      initdeferred: false
                    }}
               },
               %Proto.Constraint{
                 constraint:
                   {:foreign,
                    %Proto.Constraint.ForeignKey{
                      name: "b_a_id_fkey",
                      fk_cols: ["a_id"],
                      pk_table: %Proto.RangeVar{schema: "public", name: "c"},
                      pk_cols: ["a_id"],
                      match_type: :SIMPLE,
                      on_delete: :NO_ACTION,
                      on_update: :NO_ACTION
                    }}
               }
             ])
         }
       }}
    ]
    |> assert_migrations()
  end

  describe "indexes" do
    test "create index" do
      sqls = [
        {"""
         CREATE TABLE my_table (c1 integer, c2 integer);
         CREATE INDEX my_index ON my_table (c1, c2);
         """,
         Schema.order([
           %Proto.Index{
             name: "my_index",
             table: %Proto.RangeVar{schema: "public", name: "my_table"},
             columns: [
               %Proto.Index.Column{name: "c1"},
               %Proto.Index.Column{name: "c2"}
             ],
             using: "btree"
           }
         ])}
      ]

      for {sql, indexes} <- sqls do
        cmds = parse(sql)
        schema = Schema.update(Schema.new(), cmds)

        assert_valid_schema(schema)

        assert Schema.indexes(schema) == indexes
      end
    end

    test "adding unique constraint" do
      sqls = [
        {"""
         CREATE TABLE IF NOT EXISTS "a" (
            "aid" integer PRIMARY KEY
         );
         """,
         Schema.order([
           %Proto.Index{
             table: %Proto.RangeVar{schema: "public", name: "a"},
             name: "a_pkey",
             unique: true,
             columns: [%Proto.Index.Column{name: "aid"}]
           }
         ])},
        {"""
         CREATE TABLE IF NOT EXISTS "a" (
            "aid" integer,
            UNIQUE ("aid")
         );
         """,
         Schema.order([
           %Proto.Index{
             table: %Proto.RangeVar{schema: "public", name: "a"},
             name: "a_aid_key",
             unique: true,
             columns: [%Proto.Index.Column{name: "aid"}]
           }
         ])}
      ]

      for {sql, indexes} <- sqls do
        cmds = parse(sql)
        schema = Schema.update(Schema.new(), cmds)

        assert_valid_schema(schema)

        assert Schema.indexes(schema) == indexes
      end
    end

    test "drop index" do
      sqls = [
        {"""
         CREATE TABLE my_table (c1 integer, c2 integer);
         CREATE INDEX my_index ON my_table (c1, c2);
         DROP INDEX my_index CASCADE;
         """, []},
        {"""
         CREATE TABLE public.my_table (c1 integer, c2 integer);
         CREATE INDEX my_index ON my_table (c1, c2);
         DROP INDEX my_index CASCADE;
         """, []}
      ]

      for {sql, indexes} <- sqls do
        cmds = parse(sql)
        schema = Schema.update(Schema.new(), cmds)

        assert_valid_schema(schema)

        assert Schema.indexes(schema) == indexes
      end
    end

    test "drop index with schema" do
      sqls = [
        {"""
         CREATE TABLE my_table (c1 integer, c2 integer);
         CREATE TABLE myschema.my_table (c1 integer, c2 integer);
         CREATE INDEX my_index ON myschema.my_table (c1, c2);
         CREATE INDEX my_index ON my_table (c1, c2);
         DROP INDEX myschema.my_index, my_index CASCADE;
         """, []}
      ]

      for {sql, indexes} <- sqls do
        cmds = parse(sql)
        schema = Schema.update(Schema.new(), cmds)

        assert_valid_schema(schema)

        assert Schema.indexes(schema) == indexes
      end
    end

    test "renaming tables" do
      sqls = [
        {"""
         CREATE TABLE t1 (c1 integer, c2 integer);
         CREATE INDEX i1 ON t1 (c1, c2);
         ALTER TABLE t1 RENAME TO t2;
         """,
         Schema.order([
           %Proto.Index{
             name: "i1",
             table: %Proto.RangeVar{schema: "public", name: "t2"},
             unique: false,
             columns: [
               %Proto.Index.Column{name: "c1"},
               %Proto.Index.Column{name: "c2"}
             ],
             using: "btree"
           }
         ])}
      ]

      for {sql, indexes} <- sqls do
        cmds = parse(sql)
        schema = Schema.update(Schema.new(), cmds)

        assert_valid_schema(schema)

        assert Schema.indexes(schema) == indexes
      end
    end

    test "renaming columns" do
      sqls = [
        {"""
         CREATE TABLE t1 (c1 integer, c2 integer);
         CREATE INDEX i1 ON t1 (c1, c2);
         ALTER TABLE t1 RENAME c1 TO c3;
         """,
         Schema.order([
           %Proto.Index{
             name: "i1",
             table: %Proto.RangeVar{schema: "public", name: "t1"},
             unique: false,
             columns: [
               %Proto.Index.Column{name: "c3"},
               %Proto.Index.Column{name: "c2"}
             ],
             using: "btree"
           }
         ])},
        {"""
         CREATE TABLE t1 (c1 integer, c2 integer);
         CREATE INDEX i1 ON t1 ((log(c1) + c2));
         ALTER TABLE t1 RENAME c1 TO c3;
         """,
         Schema.order([
           %Proto.Index{
             name: "i1",
             table: %Proto.RangeVar{schema: "public", name: "t1"},
             unique: false,
             columns: [
               %Proto.Index.Column{
                 expr: %Proto.Expression{
                   expr:
                     {:aexpr,
                      %Proto.Expression.AExpr{
                        name: "+",
                        left: %Proto.Expression{
                          expr:
                            {:function,
                             %Proto.Expression.Function{
                               name: "log",
                               args: [
                                 %Proto.Expression{
                                   expr: {:col_ref, %Proto.Expression.ColumnRef{name: "c3"}}
                                 }
                               ]
                             }}
                        },
                        right: %Proto.Expression{
                          expr: {:col_ref, %Proto.Expression.ColumnRef{name: "c2"}}
                        }
                      }}
                 }
               }
             ],
             using: "btree"
           }
         ])}
      ]

      for {sql, indexes} <- sqls do
        cmds = parse(sql)
        schema = Schema.update(Schema.new(), cmds)

        assert_valid_schema(schema)

        assert Schema.indexes(schema) == indexes
      end
    end

    test "renaming constraint renames index" do
      sqls = [
        {"""
         CREATE TABLE t1 (c1 integer primary key);
         ALTER TABLE t1 RENAME CONSTRAINT t1_pkey TO my_primary_key;
         """,
         Schema.order([
           %Proto.Index{
             name: "my_primary_key",
             table: %Proto.RangeVar{schema: "public", name: "t1"},
             unique: true,
             columns: [
               %Proto.Index.Column{name: "c1"}
             ]
           }
         ])}
      ]

      for {sql, indexes} <- sqls do
        cmds = parse(sql)
        schema = Schema.update(Schema.new(), cmds)

        assert_valid_schema(schema)

        assert Schema.indexes(schema) == indexes
      end
    end

    test "dropping table drops attached indexes" do
      sqls = [
        {"""
         CREATE TABLE t1 (c1 integer, c2 integer);
         CREATE INDEX i1 ON t1 (c1, c2);
         DROP TABLE t1 CASCADE;
         """, []}
      ]

      for {sql, indexes} <- sqls do
        cmds = parse(sql)
        schema = Schema.update(Schema.new(), cmds)

        assert_valid_schema(schema)

        assert Schema.indexes(schema) == indexes
      end
    end

    test "dropping column drops attached index" do
      sqls = [
        {"""
         CREATE TABLE t1 (c1 integer, c2 integer);
         CREATE INDEX i1 ON t1 (c1, c2);
         CREATE UNIQUE INDEX i2 ON t1 (c2);
         ALTER TABLE t1 DROP COLUMN c1;
         """,
         Schema.order([
           %Proto.Index{
             name: "i2",
             table: %Proto.RangeVar{schema: "public", name: "t1"},
             unique: true,
             columns: [
               %Proto.Index.Column{name: "c2"}
             ],
             using: "btree"
           }
         ])}
      ]

      for {sql, indexes} <- sqls do
        cmds = parse(sql)
        schema = Schema.update(Schema.new(), cmds)

        assert_valid_schema(schema)

        assert Schema.indexes(schema) == indexes
      end
    end

    test "dropping unique constraint drops associated index" do
      sqls = [
        {"""
         CREATE TABLE t1 (c1 integer, c2 integer, unique (c1));
         ALTER TABLE t1 DROP CONSTRAINT t1_c1_key;
         """, []}
      ]

      for {sql, indexes} <- sqls do
        cmds = parse(sql)
        schema = Schema.update(Schema.new(), cmds)

        assert_valid_schema(schema)

        assert Schema.indexes(schema) == indexes
      end
    end

    test "alter index rename" do
      sqls = [
        {"""
         CREATE TABLE t1 (c1 integer, c2 integer);
         CREATE INDEX i1 ON t1 (c1, c2);
         ALTER INDEX i1 RENAME TO i2;
         """,
         Schema.order([
           %Proto.Index{
             name: "i2",
             table: %Proto.RangeVar{schema: "public", name: "t1"},
             unique: false,
             columns: [
               %Proto.Index.Column{name: "c1"},
               %Proto.Index.Column{name: "c2"}
             ],
             using: "btree"
           }
         ])},
        {"""
         CREATE TABLE public.t1 (c1 integer, c2 integer);
         CREATE INDEX i1 ON t1 (c1, c2);
         ALTER INDEX public.i1 RENAME TO i2;
         """,
         Schema.order([
           %Proto.Index{
             name: "i2",
             table: %Proto.RangeVar{schema: "public", name: "t1"},
             unique: false,
             columns: [
               %Proto.Index.Column{name: "c1"},
               %Proto.Index.Column{name: "c2"}
             ],
             using: "btree"
           }
         ])}
      ]

      for {sql, indexes} <- sqls do
        cmds = parse(sql)
        schema = Schema.update(Schema.new(), cmds)

        assert_valid_schema(schema)

        assert Schema.indexes(schema) == indexes
      end
    end

    test "alter constraint index rename" do
      sqls = [
        {"""
         CREATE TABLE t1 (c1 integer primary key);
         ALTER INDEX t1_pkey RENAME TO pk;
         """,
         Schema.order([
           %Proto.Index{
             name: "pk",
             table: %Proto.RangeVar{schema: "public", name: "t1"},
             unique: true,
             columns: [
               %Proto.Index.Column{name: "c1"}
             ]
           }
         ])}
      ]

      for {sql, indexes} <- sqls do
        cmds = parse(sql)
        schema = Schema.update(Schema.new(), cmds)

        assert_valid_schema(schema)

        assert Schema.indexes(schema) == indexes
        assert {:ok, table} = Schema.fetch_table(schema, "t1")
        assert [%{constraint: {_, %{name: "pk"}}}] = table.constraints
      end
    end

    test "auto generated names" do
      sqls = [
        {"""
         CREATE TABLE t1 (c1 integer, c2 integer, c3 integer);
         CREATE INDEX ON t1 (c1, c2) INCLUDE (c3);
         CREATE INDEX ON t1 (c1, c2) INCLUDE (c3);
         """,
         Schema.order([
           %Proto.Index{
             name: "t1_c1_c2_c3_idx",
             table: %Proto.RangeVar{schema: "public", name: "t1"},
             unique: false,
             columns: [
               %Proto.Index.Column{name: "c1"},
               %Proto.Index.Column{name: "c2"}
             ],
             including: ["c3"],
             using: "btree"
           },
           %Proto.Index{
             name: "t1_c1_c2_c3_idx1",
             table: %Proto.RangeVar{schema: "public", name: "t1"},
             unique: false,
             columns: [
               %Proto.Index.Column{name: "c1"},
               %Proto.Index.Column{name: "c2"}
             ],
             including: ["c3"],
             using: "btree"
           }
         ])}
      ]

      for {sql, indexes} <- sqls do
        cmds = parse(sql)
        schema = Schema.update(Schema.new(), cmds)

        assert_valid_schema(schema)

        assert Schema.indexes(schema) == indexes
        assert {:ok, _table} = Schema.fetch_table(schema, "t1")
      end
    end
  end
end
