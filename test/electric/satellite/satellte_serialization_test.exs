defmodule Electric.Satellite.SerializationTest do
  alias Electric.Satellite.Serialization

  use Electric.Satellite.Protobuf
  use ExUnit.Case, async: true

  test "test row serialization" do
    data = %{"not_null" => <<"4">>, "null" => nil, "not_present" => <<"some other value">>}
    columns = ["null", "this_columns_is_empty", "not_null"]

    serialized_data = Serialization.map_to_row(data, columns)

    expected = %SatOpRow{
      nulls_bitmask: <<1::1, 1::1, 0::1, 0::5>>,
      values: [<<>>, <<>>, <<"4">>]
    }

    assert serialized_data == expected
  end

  test "test row deserialization" do
    deserialized_data =
      Serialization.row_to_map(
        ["null", "this_columns_is_empty", "not_null"],
        %SatOpRow{nulls_bitmask: <<1::1, 1::1, 0::1, 0::5>>, values: [<<>>, <<>>, <<"4">>]}
      )

    expected = %{"not_null" => <<"4">>, "null" => nil, "this_columns_is_empty" => nil}

    assert deserialized_data == expected
  end
end
