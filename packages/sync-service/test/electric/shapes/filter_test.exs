defmodule Electric.Shapes.FilterTest do
  use ExUnit.Case
  import ExUnit.CaptureLog
  alias Electric.Replication.Changes.DeletedRecord
  alias Electric.Replication.Changes.NewRecord
  alias Electric.Replication.Changes.Relation
  alias Electric.Replication.Changes.Transaction
  alias Electric.Replication.Changes.TruncatedRelation
  alias Electric.Replication.Changes.UpdatedRecord
  alias Electric.Replication.Eval.Expr
  alias Electric.Replication.Eval.Parser.Const
  alias Electric.Replication.Eval.Parser.Func
  alias Electric.Replication.Eval.Parser.Ref
  alias Electric.Shapes.Filter
  alias Electric.Shapes.Filter.Index
  alias Electric.Shapes.Filter.Table
  alias Electric.Shapes.Shape
  alias Support.StubInspector

  @inspector StubInspector.new([
               %{name: "id", type: "int8", pk_position: 0},
               %{name: "an_array", array_type: "int8"}
             ])

  describe "add_shape/2" do
    test "with `field = constant` where clause" do
      shape = Shape.new!("the_table", where: "id = 1", inspector: @inspector)

      assert Filter.add_shape(Filter.empty(), "shape1", shape) == %Filter{
               tables: %{
                 {"public", "the_table"} => %Table{
                   indexes: %{
                     "id" => %Index{
                       type: :int8,
                       values: %{
                         1 => [
                           %{shape_id: "shape1", and_where: nil, shape: shape}
                         ]
                       }
                     }
                   },
                   other_shapes: %{}
                 }
               }
             }
    end

    # TODO optimise nil where clause
    test "with `constant = field` where clause" do
      shape = Shape.new!("the_table", where: "1 = id", inspector: @inspector)

      assert Filter.add_shape(Filter.empty(), "shape1", shape) == %Filter{
               tables: %{
                 {"public", "the_table"} => %Table{
                   indexes: %{
                     "id" => %Index{
                       type: :int8,
                       values: %{
                         1 => [
                           %{shape_id: "shape1", and_where: nil, shape: shape}
                         ]
                       }
                     }
                   },
                   other_shapes: %{}
                 }
               }
             }
    end

    test "with `field = constant AND another_condition` where clause" do
      shape = Shape.new!("the_table", where: "id = 1 AND id > 0", inspector: @inspector)

      assert %Filter{
               tables: %{
                 {"public", "the_table"} => %Table{
                   indexes: %{
                     "id" => %Index{
                       type: :int8,
                       values: %{
                         1 => [
                           %{
                             shape_id: "shape1",
                             and_where: %Expr{
                               eval: %Func{
                                 name: ~s(">"),
                                 args: [
                                   %Ref{path: ["id"], type: :int8},
                                   %Const{value: 0, type: :int4}
                                 ]
                               },
                               used_refs: %{["id"] => :int8},
                               returns: :bool
                             },
                             shape: ^shape
                           }
                         ]
                       }
                     }
                   },
                   other_shapes: %{}
                 }
               }
             } = Filter.add_shape(Filter.empty(), "shape1", shape)
    end

    test "with `some_condition AND field = constant` where clause" do
      shape = Shape.new!("the_table", where: "id > 0 AND id = 1", inspector: @inspector)

      assert %Filter{
               tables: %{
                 {"public", "the_table"} => %Table{
                   indexes: %{
                     "id" => %Index{
                       type: :int8,
                       values: %{
                         1 => [
                           %{
                             shape_id: "shape1",
                             and_where: %Expr{
                               eval: %Func{
                                 name: ~s(">"),
                                 args: [
                                   %Ref{path: ["id"], type: :int8},
                                   %Const{value: 0, type: :int4}
                                 ]
                               },
                               used_refs: %{["id"] => :int8},
                               returns: :bool
                             },
                             shape: ^shape
                           }
                         ]
                       }
                     }
                   },
                   other_shapes: %{}
                 }
               }
             } = Filter.add_shape(Filter.empty(), "shape1", shape)
    end

    test "with more complicated where clause" do
      shape = Shape.new!("the_table", where: "id > 1", inspector: @inspector)

      assert Filter.add_shape(Filter.empty(), "the-shape", shape) == %Filter{
               tables: %{
                 {"public", "the_table"} => %Table{
                   indexes: %{},
                   other_shapes: %{"the-shape" => shape}
                 }
               }
             }
    end
  end

  describe "remove_shape/2" do
    test "removes all shapes with the specified shape_id" do
      filter = %Filter{
        tables: %{
          {"public", "the_table"} => %Table{
            indexes: %{
              "id" => %Index{
                type: :int8,
                values: %{
                  1 => [
                    %{
                      shape_id: "shape1",
                      and_where: nil
                    }
                  ],
                  2 => [
                    %{
                      shape_id: "shape2",
                      and_where: nil
                    }
                  ]
                }
              },
              "name" => %Index{
                type: :text,
                values: %{
                  "bill" => [
                    %{
                      shape_id: "shape1",
                      and_where: nil
                    },
                    %{
                      shape_id: "shape2",
                      and_where: nil
                    }
                  ]
                }
              }
            },
            other_shapes: %{
              "shape1" => Shape.new!("the_table", where: "id = 1", inspector: @inspector),
              "shape2" => Shape.new!("the_table", where: "id = 2", inspector: @inspector)
            }
          },
          {"public", "another_table"} => %Table{
            indexes: %{
              "id" => %Index{
                type: :int8,
                values: %{
                  1 => [
                    %{shape_id: "shape1", and_where: nil}
                  ]
                }
              }
            },
            other_shapes: %{
              "shape1" => Shape.new!("another_table", where: "id = 1", inspector: @inspector)
            }
          }
        }
      }

      assert Filter.remove_shape(filter, "shape1") == %Filter{
               tables: %{
                 {"public", "the_table"} => %Table{
                   indexes: %{
                     "id" => %Index{
                       type: :int8,
                       values: %{
                         2 => [
                           %{
                             shape_id: "shape2",
                             and_where: nil
                           }
                         ]
                       }
                     },
                     "name" => %Index{
                       type: :text,
                       values: %{
                         "bill" => [
                           %{
                             shape_id: "shape2",
                             and_where: nil
                           }
                         ]
                       }
                     }
                   },
                   other_shapes: %{
                     "shape2" => Shape.new!("the_table", where: "id = 2", inspector: @inspector)
                   }
                 }
               }
             }
    end
  end

  describe "affected_shapes/2" do
    test "shapes with same table and id are returned" do
      filter = %Filter{
        tables: %{
          {"public", "the_table"} => %Table{
            indexes: %{
              "id" => %Index{
                type: :int8,
                values: %{
                  1 => [
                    %{shape_id: "shape1", and_where: nil},
                    %{shape_id: "shape2", and_where: nil}
                  ],
                  2 => [
                    %{shape_id: "shape3", and_where: nil},
                    %{shape_id: "shape4", and_where: nil}
                  ]
                }
              }
            },
            other_shapes: %{}
          },
          {"public", "another_table"} => %Table{
            indexes: %{
              "id" => %Index{
                type: :int8,
                values: %{
                  1 => [
                    %{shape_id: "shape5", and_where: nil}
                  ]
                }
              }
            },
            other_shapes: %{}
          }
        }
      }

      transaction =
        %Transaction{
          changes: [
            %NewRecord{
              relation: {"public", "the_table"},
              record: %{"id" => "1"}
            }
          ]
        }

      assert Filter.affected_shapes(filter, transaction) == MapSet.new(["shape1", "shape2"])
    end

    test "shapes with same table but different id are not returned" do
      filter = %Filter{
        tables: %{
          {"public", "the_table"} => %Table{
            indexes: %{
              "id" => %Index{
                type: :int8,
                values: %{
                  1 => [
                    %{shape_id: "shape1", and_where: nil},
                    %{shape_id: "shape2", and_where: nil}
                  ]
                }
              }
            },
            other_shapes: %{}
          }
        }
      }

      transaction =
        %Transaction{
          changes: [
            %NewRecord{
              relation: {"public", "the_table"},
              record: %{"id" => "2"}
            }
          ]
        }

      assert Filter.affected_shapes(filter, transaction) == MapSet.new([])
    end

    test "shapes with more complicated where clauses are evaluated" do
      filter = %Filter{
        tables: %{
          {"public", "the_table"} => %Table{
            indexes: %{},
            other_shapes: %{
              "shape1" => Shape.new!("the_table", where: "id > 7", inspector: @inspector),
              "shape2" => Shape.new!("the_table", where: "id > 6", inspector: @inspector),
              "shape3" => Shape.new!("the_table", where: "id > 5", inspector: @inspector)
            }
          }
        }
      }

      transaction =
        %Transaction{
          changes: [
            %NewRecord{
              relation: {"public", "the_table"},
              record: %{"id" => "7"}
            }
          ]
        }

      assert Filter.affected_shapes(filter, transaction) == MapSet.new(["shape2", "shape3"])
    end

    test "returns shapes affected by delete" do
      filter = %Filter{
        tables: %{
          {"public", "the_table"} => %Table{
            indexes: %{
              "id" => %Index{
                type: :int8,
                values: %{
                  1 => [
                    %{shape_id: "the-shape", and_where: nil}
                  ]
                }
              }
            },
            other_shapes: %{}
          }
        }
      }

      transaction =
        %Transaction{
          changes: [
            %DeletedRecord{
              relation: {"public", "the_table"},
              old_record: %{"id" => "1"}
            }
          ]
        }

      assert Filter.affected_shapes(filter, transaction) == MapSet.new(["the-shape"])
    end

    test "returns shapes affected by update" do
      filter = %Filter{
        tables: %{
          {"public", "the_table"} => %Table{
            indexes: %{
              "id" => %Index{
                type: :int8,
                values: %{
                  1 => [
                    %{shape_id: "shape1", and_where: nil}
                  ],
                  2 => [
                    %{shape_id: "shape2", and_where: nil}
                  ],
                  3 => [
                    %{shape_id: "shape3", and_where: nil}
                  ]
                }
              }
            },
            other_shapes: %{}
          }
        }
      }

      transaction =
        %Transaction{
          changes: [
            %UpdatedRecord{
              relation: {"public", "the_table"},
              record: %{"id" => "1"},
              old_record: %{"id" => "2"}
            }
          ]
        }

      assert Filter.affected_shapes(filter, transaction) == MapSet.new(["shape1", "shape2"])
    end

    test "returns shapes affected by relation change" do
      filter = %Filter{
        tables: %{
          {"public", "the_table"} => %Table{
            indexes: %{
              "id" => %Index{
                type: :int8,
                values: %{
                  1 => [
                    %{
                      shape_id: "shape1",
                      and_where: nil,
                      shape: Shape.new!("the_table", where: "id = 1", inspector: @inspector)
                    }
                  ],
                  2 => [
                    %{
                      shape_id: "shape2",
                      and_where: nil,
                      shape: Shape.new!("the_table", where: "id = 2", inspector: @inspector)
                    }
                  ]
                }
              }
            },
            other_shapes: %{
              "shape3" => Shape.new!("the_table", where: "id > 7", inspector: @inspector),
              "shape4" => Shape.new!("the_table", where: "id > 6", inspector: @inspector)
            }
          },
          {"public", "another_table"} => %Table{
            indexes: %{
              "id" => %Index{
                type: :int8,
                values: %{
                  1 => [
                    %{shape_id: "not-this-shape-1", and_where: nil}
                  ]
                }
              }
            },
            other_shapes: %{
              "not-this-shape-1" =>
                Shape.new!("another_table", where: "id > 7", inspector: @inspector),
              "not-this-shape-2" =>
                Shape.new!("another_table", where: "id > 6", inspector: @inspector)
            }
          }
        }
      }

      relation =
        %Relation{
          schema: "public",
          table: "the_table"
        }

      assert Filter.affected_shapes(filter, relation) ==
               MapSet.new(["shape1", "shape2", "shape3", "shape4"])
    end

    # TODO: Also go through Shape.convert_change tests to see if all scenarious are covered here

    test "returns shapes affected by truncation" do
      filter = %Filter{
        tables: %{
          {"public", "the_table"} => %Table{
            indexes: %{
              "id" => %Index{
                type: :int8,
                values: %{
                  1 => [
                    %{
                      shape_id: "shape1",
                      and_where: nil,
                      shape: Shape.new!("the_table", where: "id = 1", inspector: @inspector)
                    }
                  ],
                  2 => [
                    %{
                      shape_id: "shape2",
                      and_where: nil,
                      shape: Shape.new!("the_table", where: "id = 2", inspector: @inspector)
                    }
                  ]
                }
              }
            },
            other_shapes: %{
              "shape3" => Shape.new!("the_table", where: "id > 7", inspector: @inspector),
              "shape4" => Shape.new!("the_table", where: "id > 6", inspector: @inspector)
            }
          },
          {"public", "another_table"} => %Table{
            indexes: %{
              type: :int8,
              values: %{
                "id" => %Index{
                  type: :int8,
                  values: %{
                    1 => [
                      %{shape_id: "not-this-shape-1", and_where: nil}
                    ]
                  }
                }
              }
            },
            other_shapes: %{
              "not-this-shape-1" =>
                Shape.new!("another_table", where: "id > 7", inspector: @inspector),
              "not-this-shape-2" =>
                Shape.new!("another_table", where: "id > 6", inspector: @inspector)
            }
          }
        }
      }

      transaction =
        %TruncatedRelation{
          relation: {"public", "the_table"}
        }

      assert Filter.affected_shapes(filter, transaction) ==
               MapSet.new(["shape1", "shape2", "shape3", "shape4"])
    end
  end

  describe "where clause filtering" do
    for test <- [
          %{where: "id = 7", record: %{"id" => "7"}, affected: true},
          %{where: "id = 7", record: %{"id" => "8"}, affected: false},
          %{where: "id = 7", record: %{"id" => nil}, affected: false},
          %{where: "7 = id", record: %{"id" => "7"}, affected: true},
          %{where: "7 = id", record: %{"id" => "8"}, affected: false},
          %{where: "7 = id", record: %{"id" => nil}, affected: false},
          %{where: "id = 7 AND id > 1", record: %{"id" => "7"}, affected: true},
          %{where: "id = 7 AND id > 1", record: %{"id" => "8"}, affected: false},
          %{where: "id = 7 AND id > 8", record: %{"id" => "7"}, affected: false},
          %{where: "id > 1 AND id = 7", record: %{"id" => "7"}, affected: true},
          %{where: "id > 1 AND id = 7", record: %{"id" => "8"}, affected: false},
          %{where: "id > 8 AND id = 7", record: %{"id" => "7"}, affected: false},
          %{where: "an_array = '{1}'", record: %{"an_array" => "{1}"}, affected: true},
          %{where: "an_array = '{1}'", record: %{"an_array" => "{2}"}, affected: false},
          %{where: "an_array = '{1}'", record: %{"an_array" => "{1,2}"}, affected: false}
        ] do
      test "where: #{test.where}, record: #{inspect(test.record)}" do
        %{where: where, record: record, affected: affected} = unquote(Macro.escape(test))

        assert affected?(where, record) == affected
      end
    end

    test "Invalid record value logs an error and says all shapes are affected" do
      log =
        capture_log(fn ->
          assert affected?("id = 7", %{"id" => "invalid_value"})
        end)

      assert log =~ ~s(Could not parse value for field "id" of type :int8)
    end

    defp affected?(where, record) do
      shape = Shape.new!("the_table", where: where, inspector: @inspector)

      transaction =
        %Transaction{
          changes: [
            %NewRecord{
              relation: {"public", "the_table"},
              record: record
            }
          ]
        }

      Filter.empty()
      |> Filter.add_shape("the-shape", shape)
      |> Filter.affected_shapes(transaction) == MapSet.new(["the-shape"])
    end
  end
end
