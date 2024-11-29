defmodule Electric.Shapes.FilterTest do
  use ExUnit.Case
  alias Electric.Replication.Changes.DeletedRecord
  alias Electric.Replication.Changes.NewRecord
  alias Electric.Replication.Changes.Relation
  alias Electric.Replication.Changes.Transaction
  alias Electric.Replication.Changes.TruncatedRelation
  alias Electric.Replication.Changes.UpdatedRecord
  alias Electric.Replication.Eval.Parser.Const
  alias Electric.Replication.Eval.Parser.Func
  alias Electric.Replication.Eval.Parser.Ref
  alias Electric.Shapes.Filter
  alias Electric.Shapes.Shape
  alias Support.StubInspector

  @inspector StubInspector.new([%{name: "id", type: "int8", pk_position: 0}])

  describe "new/1" do
    test "with `field = constant` where clause" do
      shape = Shape.new!("the_table", where: "id = 1", inspector: @inspector)

      assert Filter.new(%{"shape1" => shape}) == %Filter{
               tables: %{
                 {"public", "the_table"} => %{
                   fields: %{
                     "id" => %{
                       type: :int8,
                       values: %{
                         1 => [
                           %{handle: "shape1", and_where: nil, shape: shape}
                         ]
                       }
                     }
                   },
                   other_shapes: %{}
                 }
               }
             }
    end

    test "with `constant = field` where clause" do
      shape = Shape.new!("the_table", where: "1 = id", inspector: @inspector)

      assert Filter.new(%{"shape1" => shape}) == %Filter{
               tables: %{
                 {"public", "the_table"} => %{
                   fields: %{
                     "id" => %{
                       type: :int8,
                       values: %{
                         1 => [
                           %{handle: "shape1", and_where: nil, shape: shape}
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
                 {"public", "the_table"} => %{
                   fields: %{
                     "id" => %{
                       type: :int8,
                       values: %{
                         1 => [
                           %{
                             handle: "shape1",
                             and_where: %Func{
                               name: ~s(">"),
                               args: [
                                 %Ref{path: ["id"], type: :int8},
                                 %Const{value: 0, type: :int4}
                               ]
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
             } = Filter.new(%{"shape1" => shape})
    end

    test "with `some_condition AND field = constant` where clause" do
      shape = Shape.new!("the_table", where: "id > 0 AND id = 1", inspector: @inspector)

      assert %Filter{
               tables: %{
                 {"public", "the_table"} => %{
                   fields: %{
                     "id" => %{
                       type: :int8,
                       values: %{
                         1 => [
                           %{
                             handle: "shape1",
                             and_where: %Func{
                               name: ~s(">"),
                               args: [
                                 %Ref{path: ["id"], type: :int8},
                                 %Const{value: 0, type: :int4}
                               ]
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
             } = Filter.new(%{"shape1" => shape})
    end

    test "with more complicated where clause" do
      shapes = %{"shape1" => Shape.new!("the_table", where: "id > 1", inspector: @inspector)}

      assert Filter.new(shapes) == %Filter{
               tables: %{
                 {"public", "the_table"} => %{
                   fields: %{},
                   other_shapes: shapes
                 }
               }
             }
    end
  end

  describe "remove_shape/2" do
    test "removes all shapes with the specified handle" do
      filter = %Filter{
        tables: %{
          {"public", "the_table"} => %{
            fields: %{
              "id" => %{
                type: :int8,
                values: %{
                  1 => [
                    %{
                      handle: "shape1",
                      and_where: nil
                    }
                  ],
                  2 => [
                    %{
                      handle: "shape2",
                      and_where: nil
                    }
                  ]
                }
              },
              "name" => %{
                type: :text,
                values: %{
                  "bill" => [
                    %{
                      handle: "shape1",
                      and_where: nil
                    },
                    %{
                      handle: "shape2",
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
          {"public", "another_table"} => %{
            fields: %{
              "id" => %{
                type: :int8,
                values: %{
                  1 => [
                    %{handle: "shape1", and_where: nil}
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
                 {"public", "the_table"} => %{
                   fields: %{
                     "id" => %{
                       type: :int8,
                       values: %{
                         2 => [
                           %{
                             handle: "shape2",
                             and_where: nil
                           }
                         ]
                       }
                     },
                     "name" => %{
                       type: :text,
                       values: %{
                         "bill" => [
                           %{
                             handle: "shape2",
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
          {"public", "the_table"} => %{
            fields: %{
              "id" => %{
                type: :int8,
                values: %{
                  1 => [
                    %{handle: "shape1", and_where: nil},
                    %{handle: "shape2", and_where: nil}
                  ],
                  2 => [
                    %{handle: "shape3", and_where: nil},
                    %{handle: "shape4", and_where: nil}
                  ]
                }
              }
            },
            other_shapes: %{}
          },
          {"public", "another_table"} => %{
            fields: %{
              "id" => %{
                type: :int8,
                values: %{
                  1 => [
                    %{handle: "shape5", and_where: nil}
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
          {"public", "the_table"} => %{
            fields: %{
              "id" => %{
                type: :int8,
                values: %{
                  1 => [
                    %{handle: "shape1", and_where: nil},
                    %{handle: "shape2", and_where: nil}
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
          {"public", "the_table"} => %{
            fields: %{},
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
          {"public", "the_table"} => %{
            fields: %{
              "id" => %{
                type: :int8,
                values: %{
                  1 => [
                    %{handle: "the-shape", and_where: nil}
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
          {"public", "the_table"} => %{
            fields: %{
              "id" => %{
                type: :int8,
                values: %{
                  1 => [
                    %{handle: "shape1", and_where: nil}
                  ],
                  2 => [
                    %{handle: "shape2", and_where: nil}
                  ],
                  3 => [
                    %{handle: "shape3", and_where: nil}
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
          {"public", "the_table"} => %{
            fields: %{
              "id" => %{
                type: :int8,
                values: %{
                  1 => [
                    %{
                      handle: "shape1",
                      and_where: nil,
                      shape: Shape.new!("the_table", where: "id = 1", inspector: @inspector)
                    }
                  ],
                  2 => [
                    %{
                      handle: "shape2",
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
          {"public", "another_table"} => %{
            fields: %{
              "id" => %{
                type: :int8,
                values: %{
                  1 => [
                    %{handle: "not-this-shape-1", and_where: nil}
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

    # TODO: Also go through Shape.is_affected_by_relation_change? tests to see if all scenarious are covered here
    # TODO: Also go through Shape.convert_change tests to see if all scenarious are covered here

    test "returns shapes affected by truncation" do
      filter = %Filter{
        tables: %{
          {"public", "the_table"} => %{
            fields: %{
              "id" => %{
                type: :int8,
                values: %{
                  1 => [
                    %{
                      handle: "shape1",
                      and_where: nil,
                      shape: Shape.new!("the_table", where: "id = 1", inspector: @inspector)
                    }
                  ],
                  2 => [
                    %{
                      handle: "shape2",
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
          {"public", "another_table"} => %{
            fields: %{
              type: :int8,
              values: %{
                "id" => %{
                  1 => [
                    %{handle: "not-this-shape-1", and_where: nil}
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
          %{where: "id > 8 AND id = 7", record: %{"id" => "7"}, affected: false}
        ] do
      test "where: #{test.where}, record: #{inspect(test.record)}" do
        %{where: where, record: record, affected: affected} = unquote(Macro.escape(test))

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

        expected_affected_shapes =
          if affected do
            MapSet.new(["the-shape"])
          else
            MapSet.new([])
          end

        assert Filter.new(%{"the-shape" => shape})
               |> Filter.affected_shapes(transaction) == expected_affected_shapes
      end
    end
  end
end
