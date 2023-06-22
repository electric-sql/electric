defmodule Electric.Postgres.TableTest do
  use Electric.Postgres.Case, async: true
  use ExUnitProperties

  def oid_loader(type, schema, name) do
    {:ok, Enum.join(["#{type}", schema, name], ".") |> :erlang.phash2(50_000)}
  end

  def schema_update(schema \\ Schema.new(), cmds) do
    Schema.update(schema, cmds, oid_loader: &oid_loader/3)
  end

  def assert_migrations(sqls, opts \\ []) do
    setup_sql = Keyword.get(opts, :setup, "")

    Enum.each(sqls, fn {sql, table_ast} ->
      cmds = parse(setup_sql <> sql)
      schema = schema_update(cmds)
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

  test "create simple table" do
    [
      {
        """
        CREATE TABLE public.something (
          value text
        );
        """,
        %{
          ["public", "something"] => %Proto.Table{
            name: %Proto.RangeVar{schema: "public", name: "something"},
            oid: 25336,
            columns: [%Proto.Column{name: "value", type: %Proto.Column.Type{name: "text"}}]
          }
        }
      },
      {
        """
        CREATE TABLE "t1" (
          c1 text
        );
        CREATE TABLE t2 (
          c2 int4
        );
        """,
        %{
          "t1" => %Proto.Table{
            name: %Proto.RangeVar{schema: "public", name: "t1"},
            oid: 48888,
            columns: [%Proto.Column{name: "c1", type: %Proto.Column.Type{name: "text"}}]
          },
          "t2" => %Proto.Table{
            name: %Proto.RangeVar{schema: "public", name: "t2"},
            oid: 8756,
            columns: [%Proto.Column{name: "c2", type: %Proto.Column.Type{name: "int4"}}]
          }
        }
      },
      {
        """
        CREATE TABLE "t1" (
          c1 text,
          c2 timestamp with time zone,
          c3 int[],
          c4 float4[][],
          c5 bigint[3][3],
          c6 character varying (23)
        );
        """,
        %{
          "t1" => %Proto.Table{
            name: %Proto.RangeVar{schema: "public", name: "t1"},
            oid: 48888,
            columns: [
              %Proto.Column{name: "c1", type: %Proto.Column.Type{name: "text"}},
              %Proto.Column{name: "c2", type: %Proto.Column.Type{name: "timestamptz"}},
              %Proto.Column{name: "c3", type: %Proto.Column.Type{name: "int4", array: [-1]}},
              %Proto.Column{
                name: "c4",
                type: %Proto.Column.Type{name: "float4", array: [-1, -1]}
              },
              %Proto.Column{name: "c5", type: %Proto.Column.Type{name: "int8", array: [3, 3]}},
              %Proto.Column{name: "c6", type: %Proto.Column.Type{name: "varchar", size: [23]}}
            ]
          }
        }
      },
      {
        """
        CREATE TABLE "t1" (
          c1 numeric(3, 1)
        );
        """,
        %{
          "t1" => %Proto.Table{
            name: %Proto.RangeVar{schema: "public", name: "t1"},
            oid: 48888,
            columns: [
              %Proto.Column{name: "c1", type: %Proto.Column.Type{name: "numeric", size: [3, 1]}}
            ]
          }
        }
      }
    ]
    |> assert_migrations()
  end

  test "null/not null constraints" do
    [
      {
        """
        CREATE TABLE "t1" (
          c1 integer NULL
        );
        """,
        %{
          "t1" => %Proto.Table{
            name: %Proto.RangeVar{schema: "public", name: "t1"},
            oid: 48888,
            columns: [
              %Proto.Column{name: "c1", type: %Proto.Column.Type{name: "int4"}}
            ]
          }
        }
      },
      {
        """
        CREATE TABLE "t1" (
          c1 integer NOT NULL
        );
        """,
        %{
          "t1" => %Proto.Table{
            name: %Proto.RangeVar{schema: "public", name: "t1"},
            oid: 48888,
            columns: [
              %Proto.Column{
                name: "c1",
                type: %Proto.Column.Type{name: "int4"},
                constraints: [
                  %Proto.Constraint{constraint: {:not_null, %Proto.Constraint.NotNull{}}}
                ]
              }
            ]
          }
        }
      },
      {
        """
        CREATE TABLE "t1" (
          c1 integer CONSTRAINT c1_not_null NOT NULL
        );
        """,
        %{
          "t1" => %Proto.Table{
            name: %Proto.RangeVar{schema: "public", name: "t1"},
            oid: 48888,
            columns: [
              %Proto.Column{
                name: "c1",
                type: %Proto.Column.Type{name: "int4"},
                constraints: [
                  %Proto.Constraint{
                    constraint: {:not_null, %Proto.Constraint.NotNull{name: "c1_not_null"}}
                  }
                ]
              }
            ]
          }
        }
      }
    ]
    |> assert_migrations()
  end

  test "generated columns" do
    [
      {
        """
        CREATE TABLE "t1" (
          c1 integer,
          c2 integer,
          g1 integer GENERATED ALWAYS AS (c1 + c2) STORED
        );
        """,
        %{
          "t1" => %Proto.Table{
            name: %Proto.RangeVar{schema: "public", name: "t1"},
            oid: 48888,
            columns: [
              %Proto.Column{name: "c1", type: %Proto.Column.Type{name: "int4"}},
              %Proto.Column{name: "c2", type: %Proto.Column.Type{name: "int4"}},
              %Proto.Column{
                name: "g1",
                type: %Proto.Column.Type{name: "int4"},
                constraints: [
                  %Proto.Constraint{
                    constraint:
                      {:generated,
                       %Proto.Constraint.Generated{
                         expr: %Proto.Expression{
                           expr:
                             {:aexpr,
                              %Proto.Expression.AExpr{
                                name: "+",
                                left: %Proto.Expression{
                                  expr: {:col_ref, %Proto.Expression.ColumnRef{name: "c1"}}
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
        }
      }
    ]
    |> assert_migrations()
  end

  test "column defaults" do
    [
      {
        """
        CREATE TABLE "t1" (
          c1 integer default 42
        );
        """,
        %{
          "t1" => %Proto.Table{
            name: %Proto.RangeVar{schema: "public", name: "t1"},
            oid: 48888,
            columns: [
              %Proto.Column{
                name: "c1",
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
                                value: %Proto.Expression.Value{type: :INTEGER, value: "42"}
                              }}
                         }
                       }}
                  }
                ]
              }
            ]
          }
        }
      },
      {
        """
        CREATE TABLE "t1" (
          c1 timestamp without time zone default current_time
        );
        """,
        %{
          "t1" => %Proto.Table{
            name: %Proto.RangeVar{schema: "public", name: "t1"},
            oid: 48888,
            columns: [
              %Proto.Column{
                name: "c1",
                type: %Proto.Column.Type{name: "timestamp"},
                constraints: [
                  %Proto.Constraint{
                    constraint:
                      {:default,
                       %Proto.Constraint.Default{
                         expr: %Proto.Expression{
                           expr:
                             {:vfunction,
                              %Proto.Expression.ValueFunction{name: "CURRENT_TIME", args: []}}
                         }
                       }}
                  }
                ]
              }
            ]
          }
        }
      },
      {
        """
        CREATE TABLE "t1" (
          c1 uuid default uuid_generate_v4()
        );
        """,
        %{
          "t1" => %Proto.Table{
            name: %Proto.RangeVar{schema: "public", name: "t1"},
            oid: 48888,
            columns: [
              %Proto.Column{
                name: "c1",
                type: %Proto.Column.Type{name: "uuid"},
                constraints: [
                  %Proto.Constraint{
                    constraint:
                      {:default,
                       %Proto.Constraint.Default{
                         expr: %Proto.Expression{
                           expr:
                             {:function,
                              %Proto.Expression.Function{name: "uuid_generate_v4", args: []}}
                         }
                       }}
                  }
                ]
              }
            ]
          }
        }
      },
      {
        """
        CREATE TABLE "t1" (
          c1 int default char_length('something')
        );
        """,
        %{
          "t1" => %Proto.Table{
            name: %Proto.RangeVar{schema: "public", name: "t1"},
            oid: 48888,
            columns: [
              %Proto.Column{
                name: "c1",
                type: %Proto.Column.Type{name: "int4"},
                constraints: [
                  %Proto.Constraint{
                    constraint:
                      {:default,
                       %Proto.Constraint.Default{
                         expr: %Proto.Expression{
                           expr:
                             {:function,
                              %Proto.Expression.Function{
                                name: "char_length",
                                args: [
                                  %Proto.Expression{
                                    expr:
                                      {:const,
                                       %Proto.Expression.Const{
                                         value: %Proto.Expression.Value{
                                           type: :STRING,
                                           value: "something"
                                         }
                                       }}
                                  }
                                ]
                              }}
                         }
                       }}
                  }
                ]
              }
            ]
          }
        }
      },
      {
        """
        CREATE TABLE "t1" (
          c1 int default length(uuid_generate_v4()::text)
        );
        """,
        %{
          "t1" => %Proto.Table{
            name: %Proto.RangeVar{schema: "public", name: "t1"},
            oid: 48888,
            columns: [
              %Proto.Column{
                name: "c1",
                type: %Proto.Column.Type{name: "int4"},
                constraints: [
                  %Proto.Constraint{
                    constraint:
                      {:default,
                       %Proto.Constraint.Default{
                         expr: %Proto.Expression{
                           expr:
                             {:function,
                              %Proto.Expression.Function{
                                name: "length",
                                args: [
                                  %Proto.Expression{
                                    expr:
                                      {:cast,
                                       %Proto.Expression.Cast{
                                         type: %Proto.Column.Type{
                                           name: "text",
                                           size: [],
                                           array: []
                                         },
                                         arg: %Proto.Expression{
                                           expr:
                                             {:function,
                                              %Proto.Expression.Function{
                                                name: "uuid_generate_v4",
                                                args: []
                                              }}
                                         }
                                       }}
                                  }
                                ]
                              }}
                         }
                       }}
                  }
                ]
              }
            ]
          }
        }
      }
    ]
    |> assert_migrations()
  end

  test "check constraints" do
    [
      {
        """
        CREATE TABLE "t1" (
          c1 integer CONSTRAINT "check_c1" CHECK (c1 > 0)
        );
        """,
        %{
          "t1" => %Proto.Table{
            name: %Proto.RangeVar{schema: "public", name: "t1"},
            oid: 48888,
            columns: [
              %Proto.Column{
                name: "c1",
                type: %Proto.Column.Type{name: "int4"}
              }
            ],
            constraints: [
              %Proto.Constraint{
                constraint:
                  {:check,
                   %Proto.Constraint.Check{
                     name: "check_c1",
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
                   }}
              }
            ]
          }
        }
      },
      {
        """
        CREATE TABLE "t1" (
          c1 integer CONSTRAINT "c1_gt_0" CHECK (c1 > 0) CONSTRAINT "c1_le_100" CHECK (c1 <= 100)
        );
        """,
        %{
          "t1" => %Proto.Table{
            name: %Proto.RangeVar{schema: "public", name: "t1"},
            oid: 48888,
            columns: [
              %Proto.Column{
                name: "c1",
                type: %Proto.Column.Type{name: "int4"}
              }
            ],
            constraints: [
              %Proto.Constraint{
                constraint:
                  {:check,
                   %Proto.Constraint.Check{
                     name: "c1_le_100",
                     expr: %Proto.Expression{
                       expr:
                         {:aexpr,
                          %Proto.Expression.AExpr{
                            name: "<=",
                            left: %Proto.Expression{
                              expr: {:col_ref, %Proto.Expression.ColumnRef{name: "c1"}}
                            },
                            right: %Proto.Expression{
                              expr:
                                {:const,
                                 %Proto.Expression.Const{
                                   value: %Proto.Expression.Value{
                                     type: :INTEGER,
                                     value: "100"
                                   }
                                 }}
                            }
                          }}
                     },
                     deferrable: false,
                     initdeferred: false
                   }}
              },
              %Proto.Constraint{
                constraint:
                  {:check,
                   %Proto.Constraint.Check{
                     name: "c1_gt_0",
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
                   }}
              }
            ]
          }
        }
      }
    ]
    |> assert_migrations()
  end

  test "primary keys" do
    [
      {
        """
        CREATE TABLE "t1" (
          c1 integer,
          c2 integer,
          PRIMARY KEY (c1, c2)
        );
        """,
        %{
          "t1" => %Proto.Table{
            name: %Proto.RangeVar{schema: "public", name: "t1"},
            oid: 48888,
            columns: [
              %Proto.Column{
                name: "c1",
                type: %Proto.Column.Type{name: "int4"},
                constraints: [
                  %Proto.Constraint{
                    constraint: {:not_null, %Proto.Constraint.NotNull{}}
                  }
                ]
              },
              %Proto.Column{
                name: "c2",
                type: %Proto.Column.Type{name: "int4"},
                constraints: [
                  %Proto.Constraint{
                    constraint: {:not_null, %Proto.Constraint.NotNull{}}
                  }
                ]
              }
            ],
            constraints: [
              %Proto.Constraint{
                constraint:
                  {:primary,
                   %Proto.Constraint.PrimaryKey{
                     name: "t1_pkey",
                     keys: ["c1", "c2"],
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
        CREATE TABLE "t1" (
          c1 integer,
          c2 char,
          PRIMARY KEY (c1) INCLUDE (c2)
        );
        """,
        %{
          "t1" => %Proto.Table{
            name: %Proto.RangeVar{schema: "public", name: "t1"},
            oid: 48888,
            columns: [
              %Proto.Column{
                name: "c1",
                type: %Proto.Column.Type{name: "int4"},
                constraints: [
                  %Proto.Constraint{constraint: {:not_null, %Proto.Constraint.NotNull{}}}
                ]
              },
              %Proto.Column{name: "c2", type: %Proto.Column.Type{name: "bpchar", size: [1]}}
            ],
            constraints: [
              %Proto.Constraint{
                constraint:
                  {:primary,
                   %Proto.Constraint.PrimaryKey{
                     name: "t1_pkey",
                     keys: ["c1"],
                     including: ["c2"]
                   }}
              }
            ]
          }
        }
      }
    ]
    |> assert_migrations()
  end

  test "unique constraints" do
    [
      {
        """
        CREATE TABLE "t1" (
          c1 integer,
          c2 char,
          UNIQUE (c1)
        );
        """,
        %{
          "t1" => %Proto.Table{
            name: %Proto.RangeVar{schema: "public", name: "t1"},
            oid: 48888,
            columns: [
              %Proto.Column{
                name: "c1",
                type: %Proto.Column.Type{name: "int4"}
              },
              %Proto.Column{name: "c2", type: %Proto.Column.Type{name: "bpchar", size: [1]}}
            ],
            constraints: [
              %Proto.Constraint{
                constraint:
                  {:unique,
                   %Proto.Constraint.Unique{
                     name: "t1_c1_key",
                     keys: ["c1"]
                   }}
              }
            ]
          }
        }
      },
      {
        """
        CREATE TABLE "t1" (
          c1 integer,
          c2 char,
          CONSTRAINT c1_unique UNIQUE (c1)
        );
        """,
        %{
          "t1" => %Proto.Table{
            name: %Proto.RangeVar{schema: "public", name: "t1"},
            oid: 48888,
            columns: [
              %Proto.Column{
                name: "c1",
                type: %Proto.Column.Type{name: "int4"}
              },
              %Proto.Column{name: "c2", type: %Proto.Column.Type{name: "bpchar", size: [1]}}
            ],
            constraints: [
              %Proto.Constraint{
                constraint:
                  {:unique,
                   %Proto.Constraint.Unique{
                     name: "c1_unique",
                     keys: ["c1"]
                   }}
              }
            ]
          }
        }
      },
      {
        """
        CREATE TABLE "t1" (
          c1 integer,
          c2 char,
          UNIQUE (c1, c2)
        );
        """,
        %{
          "t1" => %Proto.Table{
            name: %Proto.RangeVar{schema: "public", name: "t1"},
            oid: 48888,
            columns: [
              %Proto.Column{
                name: "c1",
                type: %Proto.Column.Type{name: "int4"}
              },
              %Proto.Column{name: "c2", type: %Proto.Column.Type{name: "bpchar", size: [1]}}
            ],
            constraints: [
              %Proto.Constraint{
                constraint:
                  {:unique,
                   %Proto.Constraint.Unique{
                     name: "t1_c1_c2_key",
                     keys: ["c1", "c2"]
                   }}
              }
            ]
          }
        }
      },
      {
        """
        CREATE TABLE "t1" (
          c1 integer,
          c2 char,
          c3 int8,
          UNIQUE (c1, c2) INCLUDE (c3)
        );
        """,
        %{
          "t1" => %Proto.Table{
            name: %Proto.RangeVar{schema: "public", name: "t1"},
            oid: 48888,
            columns: [
              %Proto.Column{
                name: "c1",
                type: %Proto.Column.Type{name: "int4"}
              },
              %Proto.Column{name: "c2", type: %Proto.Column.Type{name: "bpchar", size: [1]}},
              %Proto.Column{name: "c3", type: %Proto.Column.Type{name: "int8"}}
            ],
            constraints: [
              %Proto.Constraint{
                constraint:
                  {:unique,
                   %Proto.Constraint.Unique{
                     name: "t1_c1_c2_c3_key",
                     keys: ["c1", "c2"],
                     including: ["c3"]
                   }}
              }
            ]
          }
        }
      },
      {
        """
        CREATE TABLE "t1" (
          c1 integer UNIQUE
        );
        """,
        %{
          "t1" => %Proto.Table{
            name: %Proto.RangeVar{schema: "public", name: "t1"},
            oid: 48888,
            columns: [
              %Proto.Column{name: "c1", type: %Proto.Column.Type{name: "int4"}}
            ],
            constraints: [
              %Proto.Constraint{
                constraint:
                  {:unique,
                   %Proto.Constraint.Unique{
                     name: "t1_c1_key",
                     keys: ["c1"]
                   }}
              }
            ]
          }
        }
      },
      {
        """
        CREATE TABLE "t1" (
          c1 integer CONSTRAINT c1_unique UNIQUE
        );
        """,
        %{
          "t1" => %Proto.Table{
            name: %Proto.RangeVar{schema: "public", name: "t1"},
            oid: 48888,
            columns: [
              %Proto.Column{name: "c1", type: %Proto.Column.Type{name: "int4"}}
            ],
            constraints: [
              %Proto.Constraint{
                constraint:
                  {:unique,
                   %Proto.Constraint.Unique{
                     name: "c1_unique",
                     keys: ["c1"]
                   }}
              }
            ]
          }
        }
      }
    ]
    |> assert_migrations()
  end

  test "foreign key constraints" do
    [
      {
        """
        CREATE TABLE "t1" (
          c1 integer REFERENCES t2 (c2) MATCH FULL ON DELETE CASCADE
        );
        """,
        %{
          "t1" => %Proto.Table{
            name: %Proto.RangeVar{schema: "public", name: "t1"},
            oid: 48888,
            columns: [
              %Proto.Column{name: "c1", type: %Proto.Column.Type{name: "int4"}}
            ],
            constraints: [
              %Proto.Constraint{
                constraint:
                  {:foreign,
                   %Proto.Constraint.ForeignKey{
                     name: "t1_c1_fkey",
                     fk_cols: ["c1"],
                     pk_table: %Proto.RangeVar{schema: "public", name: "t2"},
                     pk_cols: ["c2"],
                     match_type: :FULL,
                     on_delete: :CASCADE
                   }}
              }
            ]
          }
        }
      },
      {
        """
        CREATE TABLE "t1" (
          c1 integer REFERENCES t2
        );
        """,
        %{
          "t1" => %Proto.Table{
            name: %Proto.RangeVar{schema: "public", name: "t1"},
            oid: 48888,
            columns: [
              %Proto.Column{name: "c1", type: %Proto.Column.Type{name: "int4"}}
            ],
            constraints: [
              %Proto.Constraint{
                constraint:
                  {:foreign,
                   %Proto.Constraint.ForeignKey{
                     name: "t1_c1_fkey",
                     fk_cols: ["c1"],
                     pk_table: %Proto.RangeVar{schema: "public", name: "t2"},
                     pk_cols: []
                   }}
              }
            ]
          }
        }
      },
      {
        """
        CREATE TABLE "t1" (
          c1 integer,
          c2 integer,
          FOREIGN KEY (c1, c2) REFERENCES t2 (c3, c4) MATCH FULL ON DELETE RESTRICT ON UPDATE SET NULL
        );
        """,
        %{
          "t1" => %Proto.Table{
            name: %Proto.RangeVar{schema: "public", name: "t1"},
            oid: 48888,
            columns: [
              %Proto.Column{name: "c1", type: %Proto.Column.Type{name: "int4"}},
              %Proto.Column{name: "c2", type: %Proto.Column.Type{name: "int4"}}
            ],
            constraints: [
              %Proto.Constraint{
                constraint:
                  {:foreign,
                   %Proto.Constraint.ForeignKey{
                     name: "t1_c1_c2_fkey",
                     fk_cols: ["c1", "c2"],
                     pk_table: %Proto.RangeVar{schema: "public", name: "t2"},
                     pk_cols: ["c3", "c4"],
                     match_type: :FULL,
                     on_delete: :RESTRICT,
                     on_update: :SET_NULL
                   }}
              }
            ]
          }
        }
      }
    ]
    |> assert_migrations()
  end

  test "drop table" do
    [
      {
        """
        DROP TABLE table1
        """,
        %{"table1" => :error}
      },
      {
        """
        DROP TABLE table1, myschema.table2
        """,
        %{"table1" => :error, ["myschema", "table2"] => :error}
      },
      {
        """
        DROP TABLE IF EXISTS table2 CASCADE
        """,
        %{}
      }
    ]
    |> assert_migrations(
      setup: "CREATE TABLE table1 (c1 integer); CREATE TABLE myschema.table2 (c1 integer);"
    )

    assert_raise Schema.Update.Error, fn ->
      [
        {
          """
          DROP TABLE table2 CASCADE
          """,
          %{}
        }
      ]
      |> assert_migrations()
    end
  end

  property "generated create table statements" do
    check all(sql <- SQLGenerator.Table.create_table(columns: [references: true])) do
      cmds = parse(sql)
      _schema = schema_update(cmds)
    end
  end

  describe "to_relation" do
    test "correctly maps a schema table to the SchemaRegistry representation" do
      alias Electric.Postgres.Replication.{Column, Table}

      table = %Proto.Table{
        name: %Proto.RangeVar{schema: "public", name: "t1"},
        oid: 48888,
        columns: [
          %Proto.Column{
            name: "c1",
            type: %Proto.Column.Type{name: "int4"},
            constraints: [
              %Proto.Constraint{
                constraint: {:not_null, %Proto.Constraint.NotNull{}}
              }
            ]
          },
          %Proto.Column{
            name: "c2",
            type: %Proto.Column.Type{name: "int4"},
            constraints: [
              %Proto.Constraint{
                constraint: {:not_null, %Proto.Constraint.NotNull{}}
              }
            ]
          }
        ],
        constraints: [
          %Proto.Constraint{
            constraint:
              {:primary,
               %Proto.Constraint.PrimaryKey{
                 name: "t1_pkey",
                 keys: ["c1", "c2"],
                 deferrable: false,
                 initdeferred: false
               }}
          }
        ]
      }

      assert {:ok, table_info} = Schema.table_info(table)

      assert table_info == %Table{
               schema: "public",
               name: "t1",
               oid: 48888,
               primary_keys: ["c1", "c2"],
               replica_identity: :index,
               columns: [
                 %Column{name: "c1", type: "int4", type_modifier: -1, identity?: true},
                 %Column{name: "c2", type: "int4", type_modifier: -1, identity?: true}
               ]
             }
    end
  end
end
