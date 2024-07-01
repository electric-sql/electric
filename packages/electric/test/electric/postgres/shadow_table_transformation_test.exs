defmodule Electric.Postgres.ShadowTableTransformationTest do
  use ExUnit.Case, async: true
  doctest Electric.Postgres.ShadowTableTransformation, import: true

  alias Electric.Postgres.ShadowTableTransformation
  alias Electric.Postgres.Types
  alias Electric.Replication.Changes
  alias Electric.Replication.Changes.Transaction

  import Electric.Postgres.Extension, only: [shadow_of: 1]

  @relation {"public", "test"}
  @transaction_tag {~U[2023-01-01 00:00:00Z], "no origin"}
  @pg_transaction_tag Types.ElectricTag.serialize(@transaction_tag)
  @observed "local@#{DateTime.to_unix(~U[2022-01-01 00:00:00Z], :millisecond)}"
  @shadow_table_columns [
    "_tag",
    "_is_a_delete_operation",
    "_observed_tags",
    "_modified_columns_bit_mask"
  ]

  describe "split_change_into_main_and_shadow/4" do
    test "INSERT operation gets converted and split correctly" do
      assert [main_change, shadow_change] =
               ShadowTableTransformation.split_change_into_main_and_shadow(
                 %Changes.NewRecord{
                   relation: @relation,
                   record: %{"id" => "wow", "content" => "test", "content_b" => "test_b"},
                   tags: [@observed]
                 },
                 relations(),
                 @transaction_tag,
                 nil
               )

      assert is_struct(main_change, Changes.NewRecord)
      assert main_change.relation == @relation
      assert main_change.record == %{"id" => "wow", "content" => "test", "content_b" => "test_b"}

      assert is_struct(shadow_change, Changes.NewRecord)
      assert shadow_change.relation == shadow_of(@relation)

      assert Map.take(shadow_change.record, @shadow_table_columns) == %{
               "_tag" => Types.ElectricTag.serialize(@transaction_tag),
               "_is_a_delete_operation" => "f",
               "_observed_tags" =>
                 ShadowTableTransformation.convert_tag_list_satellite_to_pg([@observed]),
               "_modified_columns_bit_mask" => Types.Array.serialize(["t", "t"])
             }
    end

    test "UPDATE operation gets converted and split correctly" do
      assert [main_change, shadow_change] =
               ShadowTableTransformation.split_change_into_main_and_shadow(
                 Changes.UpdatedRecord.new(
                   relation: @relation,
                   record: %{"id" => "wow", "content" => "test", "content_b" => "new"},
                   old_record: %{"id" => "wow", "content" => "test", "content_b" => "old"},
                   tags: [@observed]
                 ),
                 relations(),
                 @transaction_tag,
                 nil
               )

      assert is_struct(main_change, Changes.NewRecord)
      assert main_change.relation == @relation
      assert main_change.record == %{"id" => "wow", "content" => "test", "content_b" => "new"}

      assert is_struct(shadow_change, Changes.NewRecord)
      assert shadow_change.relation == shadow_of(@relation)

      assert Map.take(shadow_change.record, @shadow_table_columns) == %{
               "_tag" => Types.ElectricTag.serialize(@transaction_tag),
               "_is_a_delete_operation" => "f",
               "_observed_tags" =>
                 ShadowTableTransformation.convert_tag_list_satellite_to_pg([@observed]),
               "_modified_columns_bit_mask" => Types.Array.serialize(["f", "t"])
             }
    end

    test "DELETE operation gets converted and split correctly" do
      assert [main_change, shadow_change] =
               ShadowTableTransformation.split_change_into_main_and_shadow(
                 %Changes.DeletedRecord{
                   relation: @relation,
                   old_record: %{"id" => "wow", "content" => "test", "content_b" => "old"},
                   tags: [@observed]
                 },
                 relations(),
                 @transaction_tag,
                 nil
               )

      assert is_struct(main_change, Changes.NewRecord)
      assert main_change.relation == @relation
      assert main_change.record == %{"id" => "wow", "content" => "test", "content_b" => "old"}

      assert is_struct(shadow_change, Changes.NewRecord)
      assert shadow_change.relation == shadow_of(@relation)

      assert Map.take(shadow_change.record, @shadow_table_columns) == %{
               "_tag" => Types.ElectricTag.serialize(@transaction_tag),
               "_is_a_delete_operation" => "t",
               "_observed_tags" =>
                 ShadowTableTransformation.convert_tag_list_satellite_to_pg([@observed]),
               "_modified_columns_bit_mask" => Types.Array.serialize(["f", "f"])
             }
    end

    test "origins in tags are set to nil correctly" do
      assert [main_change, shadow_change] =
               ShadowTableTransformation.split_change_into_main_and_shadow(
                 %Changes.NewRecord{
                   relation: @relation,
                   record: %{"id" => "wow", "content" => "test", "content_b" => "test_b"},
                   tags: [@observed]
                 },
                 relations(),
                 @transaction_tag,
                 "local"
               )

      assert is_struct(main_change, Changes.NewRecord)
      assert main_change.relation == @relation
      assert main_change.record == %{"id" => "wow", "content" => "test", "content_b" => "test_b"}

      assert is_struct(shadow_change, Changes.NewRecord)
      assert shadow_change.relation == shadow_of(@relation)

      assert Map.take(shadow_change.record, @shadow_table_columns) == %{
               "_tag" => Types.ElectricTag.serialize(@transaction_tag),
               "_is_a_delete_operation" => "f",
               "_observed_tags" =>
                 {~U[2022-01-01 00:00:00.000Z], nil}
                 |> Types.ElectricTag.serialize()
                 |> List.wrap()
                 |> Types.Array.serialize(),
               "_modified_columns_bit_mask" => Types.Array.serialize(["t", "t"])
             }
    end
  end

  describe "enrich_tx_from_shadow_ops/1" do
    test "if a shadow entry is present, its tag overrides the tx timestamp & origin" do
      tx = %Transaction{
        changes: [
          %Changes.NewRecord{
            relation: shadow_of(@relation),
            record: %{"_tag" => Types.ElectricTag.serialize(@transaction_tag)}
          }
        ]
      }

      assert %Transaction{
               origin: "no origin",
               commit_timestamp: ~U[2023-01-01 00:00:00Z],
               changes: []
             } = ShadowTableTransformation.enrich_tx_from_shadow_ops(tx)
    end

    test "if a shadow entry is present, its tags are used to fill the tags of same row op" do
      tx = %Transaction{
        changes: [
          %Changes.NewRecord{
            relation: @relation,
            record: %{"id" => "wow"}
          },
          %Changes.NewRecord{
            relation: shadow_of(@relation),
            record: %{
              "id" => "wow",
              "_tag" => @pg_transaction_tag,
              "_tags" => Types.Array.serialize([@pg_transaction_tag])
            }
          }
        ]
      }

      assert %Transaction{
               origin: "no origin",
               commit_timestamp: ~U[2023-01-01 00:00:00Z],
               changes: [
                 %Electric.Replication.Changes.NewRecord{
                   relation: {"public", "test"},
                   record: %{"id" => "wow"},
                   tags: ["no origin@1672531200000"]
                 }
               ]
             } = ShadowTableTransformation.enrich_tx_from_shadow_ops(tx)
    end

    test "if multiple shadow entry changes are present, last operation in the list is preferred" do
      tx = %Transaction{
        changes:
          [
            %Changes.NewRecord{
              relation: @relation,
              record: %{"id" => "wow"}
            },
            %Changes.NewRecord{
              relation: shadow_of(@relation),
              record: %{
                "id" => "wow",
                "_tag" => @pg_transaction_tag,
                "_tags" => Types.Array.serialize([])
              }
            },
            Changes.UpdatedRecord.new(
              relation: shadow_of(@relation),
              record: %{
                "id" => "wow",
                "_tag" => @pg_transaction_tag,
                "_tags" => Types.Array.serialize([@pg_transaction_tag])
              }
            )
          ]
          # to match the parsing order of logical replication producer
          |> Enum.reverse()
      }

      assert %Transaction{
               origin: "no origin",
               commit_timestamp: ~U[2023-01-01 00:00:00Z],
               changes: [
                 %Electric.Replication.Changes.NewRecord{
                   relation: {"public", "test"},
                   record: %{"id" => "wow"},
                   tags: ["no origin@1672531200000"]
                 }
               ]
             } = ShadowTableTransformation.enrich_tx_from_shadow_ops(tx)
    end

    test "only the shadow row updates that match the row by PK are used" do
      tx = %Transaction{
        changes:
          [
            %Changes.NewRecord{
              relation: @relation,
              record: %{"id" => "wow"}
            },
            %Changes.NewRecord{
              relation: shadow_of(@relation),
              record: %{
                "id" => "not wow",
                "_tag" => @pg_transaction_tag,
                "_tags" => Types.Array.serialize([@pg_transaction_tag])
              }
            },
            %Changes.NewRecord{
              relation: shadow_of(@relation),
              record: %{
                "id" => "wow",
                "_tag" => @pg_transaction_tag,
                "_tags" =>
                  Types.Array.serialize([
                    Types.ElectricTag.serialize({~U[2023-01-01 00:00:00Z], "correct"})
                  ])
              }
            }
          ]
          |> Enum.reverse()
      }

      assert %Transaction{
               origin: "no origin",
               commit_timestamp: ~U[2023-01-01 00:00:00Z],
               changes: [
                 %Electric.Replication.Changes.NewRecord{
                   relation: {"public", "test"},
                   record: %{"id" => "wow"},
                   tags: ["correct@1672531200000"]
                 }
               ]
             } = ShadowTableTransformation.enrich_tx_from_shadow_ops(tx)
    end
  end

  defp relations() do
    %{
      @relation => %{
        primary_keys: ["id"],
        columns: [%{name: "id"}, %{name: "content"}, %{name: "content_b"}]
      },
      shadow_of(@relation) => %{
        primary_keys: ["id"],
        # The functions don't actually use this column list, so I'll save me some typing
        columns: []
      }
    }
  end
end
