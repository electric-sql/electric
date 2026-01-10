# Example of the AST of the WHERE clause `a = 1 OR b IN (SELECT id FROM t1)`

%PgQuery.Node{
  node:
    {:bool_expr,
     %PgQuery.BoolExpr{
       location: 21,
       args: [
         %PgQuery.Node{
           node:
             {:a_expr,
              %PgQuery.A_Expr{
                location: 17,
                rexpr: %PgQuery.Node{
                  node:
                    {:a_const,
                     %PgQuery.A_Const{
                       location: 19,
                       isnull: false,
                       val: {:ival, %PgQuery.Integer{ival: 1}}
                     }}
                },
                lexpr: %PgQuery.Node{
                  node:
                    {:column_ref,
                     %PgQuery.ColumnRef{
                       location: 15,
                       fields: [
                         %PgQuery.Node{
                           node: {:string, %PgQuery.String{sval: "a"}}
                         }
                       ]
                     }}
                },
                name: [
                  %PgQuery.Node{
                    node: {:string, %PgQuery.String{sval: "="}}
                  }
                ],
                kind: :AEXPR_OP
              }}
         },
         %PgQuery.Node{
           node:
             {:sub_link,
              %PgQuery.SubLink{
                location: 26,
                # Contents don't matter, SubLink is atomic for our purposes
                subselect: %PgQuery.Node{},
                oper_name: [],
                testexpr: %PgQuery.Node{
                  node:
                    {:column_ref,
                     %PgQuery.ColumnRef{
                       location: 24,
                       fields: [
                         %PgQuery.Node{
                           node: {:string, %PgQuery.String{sval: "b"}}
                         }
                       ]
                     }}
                },
                sub_link_id: 0,
                sub_link_type: :ANY_SUBLINK,
                xpr: nil
              }}
         }
       ],
       boolop: :OR_EXPR,
       xpr: nil
     }}
}

# Example of the AST of the WHERE clause `a = 1 AND (b = 2 OR c = 3)`
%PgQuery.Node{
  node:
    {:bool_expr,
     %PgQuery.BoolExpr{
       location: 21,
       args: [
         %PgQuery.Node{
           node:
             {:a_expr,
              %PgQuery.A_Expr{
                location: 17,
                rexpr: %PgQuery.Node{
                  node:
                    {:a_const,
                     %PgQuery.A_Const{
                       location: 19,
                       isnull: false,
                       val: {:ival, %PgQuery.Integer{ival: 1}}
                     }}
                },
                lexpr: %PgQuery.Node{
                  node:
                    {:column_ref,
                     %PgQuery.ColumnRef{
                       location: 15,
                       fields: [
                         %PgQuery.Node{
                           node: {:string, %PgQuery.String{sval: "a"}}
                         }
                       ]
                     }}
                },
                name: [
                  %PgQuery.Node{
                    node: {:string, %PgQuery.String{sval: "="}}
                  }
                ],
                kind: :AEXPR_OP
              }}
         },
         %PgQuery.Node{
           node:
             {:bool_expr,
              %PgQuery.BoolExpr{
                location: 32,
                args: [
                  %PgQuery.Node{
                    node:
                      {:a_expr,
                       %PgQuery.A_Expr{
                         location: 28,
                         rexpr: %PgQuery.Node{
                           node:
                             {:a_const,
                              %PgQuery.A_Const{
                                location: 30,
                                isnull: false,
                                val: {:ival, %PgQuery.Integer{ival: 2}}
                              }}
                         },
                         lexpr: %PgQuery.Node{
                           node:
                             {:column_ref,
                              %PgQuery.ColumnRef{
                                location: 26,
                                fields: [
                                  %PgQuery.Node{
                                    node: {:string, %PgQuery.String{sval: "b"}}
                                  }
                                ]
                              }}
                         },
                         name: [
                           %PgQuery.Node{
                             node: {:string, %PgQuery.String{sval: "="}}
                           }
                         ],
                         kind: :AEXPR_OP
                       }}
                  },
                  %PgQuery.Node{
                    node:
                      {:a_expr,
                       %PgQuery.A_Expr{
                         location: 37,
                         rexpr: %PgQuery.Node{
                           node:
                             {:a_const,
                              %PgQuery.A_Const{
                                location: 39,
                                isnull: false,
                                val: {:ival, %PgQuery.Integer{ival: 3}}
                              }}
                         },
                         lexpr: %PgQuery.Node{
                           node:
                             {:column_ref,
                              %PgQuery.ColumnRef{
                                location: 35,
                                fields: [
                                  %PgQuery.Node{
                                    node: {:string, %PgQuery.String{sval: "c"}}
                                  }
                                ]
                              }}
                         },
                         name: [
                           %PgQuery.Node{
                             node: {:string, %PgQuery.String{sval: "="}}
                           }
                         ],
                         kind: :AEXPR_OP
                       }}
                  }
                ],
                boolop: :OR_EXPR,
                xpr: nil
              }}
         }
       ],
       boolop: :AND_EXPR,
       xpr: nil
     }}
}
