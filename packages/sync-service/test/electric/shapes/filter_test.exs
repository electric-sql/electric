defmodule Electric.Shapes.FilterTest do
  use ExUnit.Case
  alias Electric.Replication.Changes.DeletedRecord
  alias Electric.Replication.Changes.NewRecord
  alias Electric.Replication.Changes.Transaction
  alias Electric.Replication.Changes.Relation
  alias Electric.Replication.Changes.UpdatedRecord
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
                       "1" => [
                         %{handle: "shape1", and_where: nil, shape: shape}
                       ]
                     }
                   },
                   other_shapes: %{}
                 }
               }
             }
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

  # TODO: relations

  describe "affected_shapes/2" do
    test "shapes with same table and id are returned" do
      filter = %Filter{
        tables: %{
          {"public", "the_table"} => %{
            fields: %{
              "id" => %{
                "1" => [
                  %{handle: "shape1", and_where: nil},
                  %{handle: "shape2", and_where: nil}
                ],
                "2" => [
                  %{handle: "shape3", and_where: nil},
                  %{handle: "shape4", and_where: nil}
                ]
              }
            },
            other_shapes: %{}
          },
          {"public", "another_table"} => %{
            fields: %{
              "id" => %{
                "1" => [
                  %{handle: "shape5", and_where: nil}
                ]
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
                "1" => [
                  %{handle: "shape1", and_where: nil},
                  %{handle: "shape2", and_where: nil}
                ]
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
                "1" => [
                  %{handle: "the-shape", and_where: nil}
                ]
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
                "1" => [
                  %{handle: "shape1", and_where: nil}
                ],
                "2" => [
                  %{handle: "shape2", and_where: nil}
                ],
                "3" => [
                  %{handle: "shape3", and_where: nil}
                ]
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
                "1" => [
                  %{
                    handle: "shape1",
                    and_where: nil,
                    shape: Shape.new!("the_table", where: "id = 1", inspector: @inspector)
                  }
                ],
                "2" => [
                  %{
                    handle: "shape2",
                    and_where: nil,
                    shape: Shape.new!("the_table", where: "id = 2", inspector: @inspector)
                  }
                ]
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
                "1" => [
                  %{handle: "not-this-shape-1", and_where: nil}
                ]
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
  end
end
