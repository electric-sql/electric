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

  test "test row deserialization with long bitmask" do
    mask = <<0b1101000010000000::16>>

    deserialized_data =
      Serialization.row_to_map(
        Enum.map(0..8, &"bit#{&1}"),
        %SatOpRow{nulls_bitmask: mask, values: Enum.map(0..8, fn _ -> "" end)}
      )

    expected = %{
      "bit0" => nil,
      "bit1" => nil,
      "bit2" => "",
      "bit3" => nil,
      "bit4" => "",
      "bit5" => "",
      "bit6" => "",
      "bit7" => "",
      "bit8" => nil
    }

    assert deserialized_data == expected
  end

  test "test row serialization 2" do
    data = %{
      "content" => "hello from pg_1",
      "content_text_null" => nil,
      "content_text_null_default" => "",
      "id" => "f989b58b-980d-4d3c-b178-adb6ae8222f1",
      "intvalue_null" => nil,
      "intvalue_null_default" => "10"
    }

    columns = [
      "id",
      "content",
      "content_text_null",
      "content_text_null_default",
      "intvalue_null",
      "intvalue_null_default"
    ]

    serialized_data = Serialization.map_to_row(data, columns)

    expected = %SatOpRow{
      nulls_bitmask: <<0::1, 0::1, 1::1, 0::1, 1::1, 0::3>>,
      values: ["f989b58b-980d-4d3c-b178-adb6ae8222f1", "hello from pg_1", "", "", "", "10"]
    }

    assert serialized_data == expected
  end
end
