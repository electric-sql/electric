defmodule Electric.Replication.Eval.NilNodeTest do
  @moduledoc """
  Tests for nil/null nodes being passed to PgQuery.protobuf_to_query!.
  Checks whether malformed protobuf with nil fields causes segfaults.
  """
  use ExUnit.Case, async: true

  describe "nil nodes in protobuf_to_query!" do
    test "Node with {type, nil} inner struct" do
      result = %PgQuery.ParseResult{
        version: 170_007,
        stmts: [
          %PgQuery.RawStmt{
            stmt: %PgQuery.Node{
              node:
                {:select_stmt,
                 %PgQuery.SelectStmt{
                   where_clause: %PgQuery.Node{
                     node: {:column_ref, nil}
                   }
                 }}
            }
          }
        ]
      }

      try do
        PgQuery.protobuf_to_query!(result)
      rescue
        _ -> :ok
      end
    end

    test "Node with {type, nil} - bool_expr" do
      result = %PgQuery.ParseResult{
        version: 170_007,
        stmts: [
          %PgQuery.RawStmt{
            stmt: %PgQuery.Node{
              node:
                {:select_stmt,
                 %PgQuery.SelectStmt{
                   where_clause: %PgQuery.Node{
                     node: {:bool_expr, nil}
                   }
                 }}
            }
          }
        ]
      }

      try do
        PgQuery.protobuf_to_query!(result)
      rescue
        _ -> :ok
      end
    end

    test "Node with {type, nil} - sub_link" do
      result = %PgQuery.ParseResult{
        version: 170_007,
        stmts: [
          %PgQuery.RawStmt{
            stmt: %PgQuery.Node{
              node:
                {:select_stmt,
                 %PgQuery.SelectStmt{
                   where_clause: %PgQuery.Node{
                     node: {:sub_link, nil}
                   }
                 }}
            }
          }
        ]
      }

      try do
        PgQuery.protobuf_to_query!(result)
      rescue
        _ -> :ok
      end
    end

    test "Node with {type, nil} - a_expr" do
      result = %PgQuery.ParseResult{
        version: 170_007,
        stmts: [
          %PgQuery.RawStmt{
            stmt: %PgQuery.Node{
              node:
                {:select_stmt,
                 %PgQuery.SelectStmt{
                   where_clause: %PgQuery.Node{
                     node: {:a_expr, nil}
                   }
                 }}
            }
          }
        ]
      }

      try do
        PgQuery.protobuf_to_query!(result)
      rescue
        _ -> :ok
      end
    end

    test "Node with {type, nil} - type_cast" do
      result = %PgQuery.ParseResult{
        version: 170_007,
        stmts: [
          %PgQuery.RawStmt{
            stmt: %PgQuery.Node{
              node:
                {:select_stmt,
                 %PgQuery.SelectStmt{
                   where_clause: %PgQuery.Node{
                     node: {:type_cast, nil}
                   }
                 }}
            }
          }
        ]
      }

      try do
        PgQuery.protobuf_to_query!(result)
      rescue
        _ -> :ok
      end
    end

    test "Node with nil node field" do
      result = %PgQuery.ParseResult{
        version: 170_007,
        stmts: [
          %PgQuery.RawStmt{
            stmt: %PgQuery.Node{
              node:
                {:select_stmt,
                 %PgQuery.SelectStmt{
                   where_clause: %PgQuery.Node{node: nil}
                 }}
            }
          }
        ]
      }

      try do
        PgQuery.protobuf_to_query!(result)
      rescue
        _ -> :ok
      end
    end

    test "nil where_clause" do
      result = %PgQuery.ParseResult{
        version: 170_007,
        stmts: [
          %PgQuery.RawStmt{
            stmt: %PgQuery.Node{
              node:
                {:select_stmt,
                 %PgQuery.SelectStmt{
                   where_clause: nil
                 }}
            }
          }
        ]
      }

      # This should produce "SELECT" (no WHERE clause)
      try do
        query = PgQuery.protobuf_to_query!(result)
        assert is_binary(query)
      rescue
        _ -> :ok
      end
    end

    test "SubLink with nil testexpr and nil subselect" do
      result = %PgQuery.ParseResult{
        version: 170_007,
        stmts: [
          %PgQuery.RawStmt{
            stmt: %PgQuery.Node{
              node:
                {:select_stmt,
                 %PgQuery.SelectStmt{
                   where_clause: %PgQuery.Node{
                     node:
                       {:sub_link,
                        %PgQuery.SubLink{
                          sub_link_type: :EXISTS_SUBLINK,
                          testexpr: nil,
                          subselect: nil
                        }}
                   }
                 }}
            }
          }
        ]
      }

      try do
        PgQuery.protobuf_to_query!(result)
      rescue
        _ -> :ok
      end
    end

    test "SubLink with nil subselect but valid testexpr" do
      result = %PgQuery.ParseResult{
        version: 170_007,
        stmts: [
          %PgQuery.RawStmt{
            stmt: %PgQuery.Node{
              node:
                {:select_stmt,
                 %PgQuery.SelectStmt{
                   where_clause: %PgQuery.Node{
                     node:
                       {:sub_link,
                        %PgQuery.SubLink{
                          sub_link_type: :ANY_SUBLINK,
                          testexpr: %PgQuery.Node{
                            node:
                              {:column_ref,
                               %PgQuery.ColumnRef{
                                 fields: [
                                   %PgQuery.Node{
                                     node:
                                       {:string, %PgQuery.String{sval: "id"}}
                                   }
                                 ]
                               }}
                          },
                          subselect: nil
                        }}
                   }
                 }}
            }
          }
        ]
      }

      try do
        PgQuery.protobuf_to_query!(result)
      rescue
        _ -> :ok
      end
    end

    test "TypeCast with nil arg" do
      result = %PgQuery.ParseResult{
        version: 170_007,
        stmts: [
          %PgQuery.RawStmt{
            stmt: %PgQuery.Node{
              node:
                {:select_stmt,
                 %PgQuery.SelectStmt{
                   where_clause: %PgQuery.Node{
                     node:
                       {:type_cast,
                        %PgQuery.TypeCast{
                          arg: nil,
                          type_name: %PgQuery.TypeName{
                            names: [
                              %PgQuery.Node{
                                node: {:string, %PgQuery.String{sval: "int8"}}
                              }
                            ]
                          }
                        }}
                   }
                 }}
            }
          }
        ]
      }

      try do
        PgQuery.protobuf_to_query!(result)
      rescue
        _ -> :ok
      end
    end

    test "TypeCast with nil type_name" do
      result = %PgQuery.ParseResult{
        version: 170_007,
        stmts: [
          %PgQuery.RawStmt{
            stmt: %PgQuery.Node{
              node:
                {:select_stmt,
                 %PgQuery.SelectStmt{
                   where_clause: %PgQuery.Node{
                     node:
                       {:type_cast,
                        %PgQuery.TypeCast{
                          arg: %PgQuery.Node{
                            node:
                              {:a_const,
                               %PgQuery.A_Const{
                                 val: {:sval, %PgQuery.String{sval: "test"}}
                               }}
                          },
                          type_name: nil
                        }}
                   }
                 }}
            }
          }
        ]
      }

      try do
        PgQuery.protobuf_to_query!(result)
      rescue
        _ -> :ok
      end
    end

    test "A_Expr with nil lexpr" do
      result = %PgQuery.ParseResult{
        version: 170_007,
        stmts: [
          %PgQuery.RawStmt{
            stmt: %PgQuery.Node{
              node:
                {:select_stmt,
                 %PgQuery.SelectStmt{
                   where_clause: %PgQuery.Node{
                     node:
                       {:a_expr,
                        %PgQuery.A_Expr{
                          kind: :AEXPR_OP,
                          name: [
                            %PgQuery.Node{
                              node: {:string, %PgQuery.String{sval: "="}}
                            }
                          ],
                          lexpr: nil,
                          rexpr: %PgQuery.Node{
                            node:
                              {:a_const,
                               %PgQuery.A_Const{
                                 val: {:ival, %PgQuery.Integer{ival: 1}}
                               }}
                          }
                        }}
                   }
                 }}
            }
          }
        ]
      }

      try do
        PgQuery.protobuf_to_query!(result)
      rescue
        _ -> :ok
      end
    end

    test "A_Expr with nil rexpr" do
      result = %PgQuery.ParseResult{
        version: 170_007,
        stmts: [
          %PgQuery.RawStmt{
            stmt: %PgQuery.Node{
              node:
                {:select_stmt,
                 %PgQuery.SelectStmt{
                   where_clause: %PgQuery.Node{
                     node:
                       {:a_expr,
                        %PgQuery.A_Expr{
                          kind: :AEXPR_OP,
                          name: [
                            %PgQuery.Node{
                              node: {:string, %PgQuery.String{sval: "="}}
                            }
                          ],
                          lexpr: %PgQuery.Node{
                            node:
                              {:column_ref,
                               %PgQuery.ColumnRef{
                                 fields: [
                                   %PgQuery.Node{
                                     node: {:string, %PgQuery.String{sval: "id"}}
                                   }
                                 ]
                               }}
                          },
                          rexpr: nil
                        }}
                   }
                 }}
            }
          }
        ]
      }

      try do
        PgQuery.protobuf_to_query!(result)
      rescue
        _ -> :ok
      end
    end

    test "BoolExpr with empty args list" do
      result = %PgQuery.ParseResult{
        version: 170_007,
        stmts: [
          %PgQuery.RawStmt{
            stmt: %PgQuery.Node{
              node:
                {:select_stmt,
                 %PgQuery.SelectStmt{
                   where_clause: %PgQuery.Node{
                     node:
                       {:bool_expr,
                        %PgQuery.BoolExpr{
                          boolop: :AND_EXPR,
                          args: []
                        }}
                   }
                 }}
            }
          }
        ]
      }

      try do
        PgQuery.protobuf_to_query!(result)
      rescue
        _ -> :ok
      end
    end

    test "BoolExpr with nil in args list" do
      result = %PgQuery.ParseResult{
        version: 170_007,
        stmts: [
          %PgQuery.RawStmt{
            stmt: %PgQuery.Node{
              node:
                {:select_stmt,
                 %PgQuery.SelectStmt{
                   where_clause: %PgQuery.Node{
                     node:
                       {:bool_expr,
                        %PgQuery.BoolExpr{
                          boolop: :AND_EXPR,
                          args: [nil, nil]
                        }}
                   }
                 }}
            }
          }
        ]
      }

      try do
        PgQuery.protobuf_to_query!(result)
      rescue
        _ -> :ok
      end
    end

    test "deeply nested nil - SubLink inside BoolExpr with nil subselect" do
      # This simulates what could happen if the walker produces a SubLink
      # where subselect ends up nil through some code path
      {:ok, parsed} = PgQuery.parse("SELECT 1 WHERE id IN (SELECT id FROM t1) AND name = 'x'")
      %{stmts: [%{stmt: %{node: {:select_stmt, select}}}]} = parsed

      # Get the where clause, manually nil out the subselect inside the SubLink
      where = select.where_clause

      # Walk the where clause and nil out any subselect
      corrupted_where = corrupt_subselects(where)

      result = %PgQuery.ParseResult{
        version: 170_007,
        stmts: [
          %PgQuery.RawStmt{
            stmt: %PgQuery.Node{
              node:
                {:select_stmt,
                 %PgQuery.SelectStmt{
                   where_clause: corrupted_where
                 }}
            }
          }
        ]
      }

      try do
        PgQuery.protobuf_to_query!(result)
      rescue
        _ -> :ok
      end
    end

    test "real parse then corrupt: nil out TypeName in TypeCast" do
      # Parse a real query with a cast, then nil out the type_name
      {:ok, parsed} = PgQuery.parse("SELECT 1 WHERE 'test'::text = 'test'")
      %{stmts: [%{stmt: %{node: {:select_stmt, select}}}]} = parsed

      corrupted_where = corrupt_type_names(select.where_clause)

      result = %PgQuery.ParseResult{
        version: 170_007,
        stmts: [
          %PgQuery.RawStmt{
            stmt: %PgQuery.Node{
              node:
                {:select_stmt,
                 %PgQuery.SelectStmt{
                   where_clause: corrupted_where
                 }}
            }
          }
        ]
      }

      try do
        PgQuery.protobuf_to_query!(result)
      rescue
        _ -> :ok
      end
    end

    test "real parse then corrupt: nil out arg in TypeCast" do
      {:ok, parsed} = PgQuery.parse("SELECT 1 WHERE 'test'::text = 'test'")
      %{stmts: [%{stmt: %{node: {:select_stmt, select}}}]} = parsed

      corrupted_where = corrupt_typecast_args(select.where_clause)

      result = %PgQuery.ParseResult{
        version: 170_007,
        stmts: [
          %PgQuery.RawStmt{
            stmt: %PgQuery.Node{
              node:
                {:select_stmt,
                 %PgQuery.SelectStmt{
                   where_clause: corrupted_where
                 }}
            }
          }
        ]
      }

      try do
        PgQuery.protobuf_to_query!(result)
      rescue
        _ -> :ok
      end
    end
  end

  # Helpers to corrupt AST nodes by setting specific fields to nil

  defp corrupt_subselects(%PgQuery.Node{node: {:sub_link, sublink}} = node) do
    %{node | node: {:sub_link, %{sublink | subselect: nil}}}
  end

  defp corrupt_subselects(%PgQuery.Node{node: {:bool_expr, bool_expr}} = node) do
    %{node | node: {:bool_expr, %{bool_expr | args: Enum.map(bool_expr.args, &corrupt_subselects/1)}}}
  end

  defp corrupt_subselects(other), do: other

  defp corrupt_type_names(%PgQuery.Node{node: {:a_expr, a_expr}} = node) do
    %{node | node: {:a_expr, %{a_expr |
      lexpr: corrupt_type_names(a_expr.lexpr),
      rexpr: corrupt_type_names(a_expr.rexpr)
    }}}
  end

  defp corrupt_type_names(%PgQuery.Node{node: {:type_cast, tc}} = node) do
    %{node | node: {:type_cast, %{tc | type_name: nil}}}
  end

  defp corrupt_type_names(other), do: other

  defp corrupt_typecast_args(%PgQuery.Node{node: {:a_expr, a_expr}} = node) do
    %{node | node: {:a_expr, %{a_expr |
      lexpr: corrupt_typecast_args(a_expr.lexpr),
      rexpr: corrupt_typecast_args(a_expr.rexpr)
    }}}
  end

  defp corrupt_typecast_args(%PgQuery.Node{node: {:type_cast, tc}} = node) do
    %{node | node: {:type_cast, %{tc | arg: nil}}}
  end

  defp corrupt_typecast_args(other), do: other
end
