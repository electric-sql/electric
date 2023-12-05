defmodule Electric.Satellite.WriteValidationTest do
  use ExUnit.Case, async: true

  alias Electric.Satellite.WriteValidation
  alias Electric.Postgres.MockSchemaLoader
  alias Electric.Postgres.Extension.SchemaLoader
  alias Electric.Replication.Changes

  @single_pk {"public", "single_pk"}

  def valid_tx(lsn) do
    %Changes.Transaction{
      lsn: lsn,
      changes: [
        %Changes.NewRecord{
          relation: @single_pk,
          record: %{
            "id" => "a6c8f529-7be1-412c-ab4b-a52612137e56",
            "value" => "value 1",
            "amount" => "1"
          }
        },
        %Changes.NewRecord{
          relation: @single_pk,
          record: %{
            "id" => "5f8bf361-0e9f-4108-a92e-af37e97e38da",
            "value" => "value 2",
            "amount" => "2"
          }
        }
      ]
    }
  end

  def invalid_tx(lsn) do
    %Changes.Transaction{
      lsn: lsn,
      changes: [
        # invalid because it fails WriteValidation.ImmutablePrimaryKey
        Changes.UpdatedRecord.new(
          relation: @single_pk,
          old_record: %{
            "id" => "a6c8f529-7be1-412c-ab4b-a52612137e56",
            "value" => "value 1",
            "amount" => "1"
          },
          record: %{
            "id" => "388005b1-5bc8-4428-9933-6dffa598ce93",
            "value" => "value 3",
            "amount" => "3"
          }
        ),
        Changes.UpdatedRecord.new(
          relation: @single_pk,
          old_record: %{
            "id" => "5f8bf361-0e9f-4108-a92e-af37e97e38da",
            "value" => "value 2",
            "amount" => "2"
          },
          record: %{
            "id" => "5f8bf361-0e9f-4108-a92e-af37e97e38da",
            "value" => "value 2",
            "amount" => "2"
          }
        )
      ]
    }
  end

  describe "validate_transactions!/3" do
    setup do
      migrations = [
        {"001",
         [
           """
           CREATE TABLE public.single_pk (
               id uuid PRIMARY KEY,
               value text,
               amount integer
           );
           """,
           """
           CREATE TABLE public.compound_pk (
               id uuid,
               owner uuid,
               value text,
               amount integer,
               PRIMARY KEY (id, owner)
           );
           """
         ]}
      ]

      {:ok, loader} =
        MockSchemaLoader.backend_spec(migrations: migrations)
        |> SchemaLoader.connect([])

      {:ok, loader: loader}
    end

    test "invalid_tx/1", cxt do
      {:ok, schema} = SchemaLoader.load(cxt.loader)

      assert Enum.any?(
               invalid_tx("001").changes,
               &match?(
                 {:error, _},
                 WriteValidation.ImmutablePrimaryKey.validate_update(&1, schema, cxt.loader)
               )
             )
    end

    test "allows valid transactions", cxt do
      txns = [
        valid_tx("001"),
        valid_tx("002"),
        valid_tx("003")
      ]

      assert {:ok, ^txns} = WriteValidation.validate_transactions!(txns, cxt.loader)
    end

    test "splits valid and invalid with an error", cxt do
      pre = [
        valid_tx("001"),
        valid_tx("002")
      ]

      invalid = invalid_tx("003")

      post = [
        valid_tx("004"),
        valid_tx("005")
      ]

      txns = pre ++ [invalid] ++ post

      assert {:error, ^pre, error, ^post} =
               WriteValidation.validate_transactions!(txns, cxt.loader)

      assert %{
               tx: ^invalid,
               verifier: WriteValidation.ImmutablePrimaryKey
             } = error
    end
  end
end
