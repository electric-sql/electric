defmodule Electric.Postgres.SqlGeneratorTest do
  use ExUnit.Case, async: true

  alias Electric.Postgres.Schema.Proto
  alias Electric.Postgres.SQLGenerator

  test "can map a schema table to a simplified property one" do
    orig = %Proto.Table{
      name: %Proto.RangeVar{name: "trouble", schema: "some"},
      columns: [
        %Proto.Column{name: "col1", type: %Proto.Column.Type{name: "int4"}},
        %Proto.Column{name: "col2", type: %Proto.Column.Type{name: "varchar"}},
        %Proto.Column{name: "col3", type: %Proto.Column.Type{name: "int4"}}
      ],
      constraints: [
        %Proto.Constraint{
          constraint:
            {:primary, %Proto.Constraint.PrimaryKey{name: "trouble_pkey", keys: ["col1"]}}
        },
        %Proto.Constraint{
          constraint:
            {:unique, %Proto.Constraint.Unique{name: "trouble_col3_key", keys: ["col3"]}}
        },
        %Proto.Constraint{
          constraint:
            {:foreign, %Proto.Constraint.ForeignKey{name: "trouble_col2_fkey", fk_cols: ["col2"]}}
        }
      ],
      indexes: [
        %Proto.Index{
          name: "my_index",
          columns: [%Proto.Index.Column{name: "col3"}],
          including: ["col2"],
          unique: false
        }
      ]
    }

    table = SQLGenerator.map_table(orig)

    assert table == %SQLGenerator.Table{
             name: {"some", "trouble"},
             columns: [
               {"col1", {:int, "int4"}, %{pk: true}},
               {"col2", {:str, "varchar"}, %{pk: false}},
               {"col3", {:int, "int4"}, %{pk: false}}
             ],
             constraints: [
               primary: {"trouble_pkey", ["col1"]},
               unique: {"trouble_col3_key", ["col3"]},
               foreign: {"trouble_col2_fkey", ["col2"]}
             ],
             indexes: [
               {"my_index", ["col3"]}
             ]
           }
  end
end
