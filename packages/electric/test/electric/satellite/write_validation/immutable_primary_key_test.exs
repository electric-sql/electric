defmodule Electric.Satellite.WriteValidation.ImmutablePrimaryKeyTest do
  use ExUnit.Case, async: true

  alias Electric.Postgres.Schema
  alias Electric.Postgres.MockSchemaLoader
  alias Electric.Postgres.Extension.SchemaLoader
  alias Electric.Replication.Changes

  alias Electric.Satellite.WriteValidation.ImmutablePrimaryKey

  setup do
    migrations = [
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
    ]

    oid_loader = &MockSchemaLoader.oid_loader/3

    schema =
      Enum.reduce(migrations, Schema.new(), &Schema.update(&2, &1, oid_loader: oid_loader))

    schema = SchemaLoader.Version.new("001", schema)

    assert {:ok, ["id"]} = SchemaLoader.Version.primary_keys(schema, "public", "single_pk")

    assert {:ok, ["id", "owner"]} =
             SchemaLoader.Version.primary_keys(schema, "public", "compound_pk")

    {:ok, schema: schema}
  end

  test "allows inserts", cxt do
    assert :ok =
             ImmutablePrimaryKey.validate_insert(
               %Changes.NewRecord{
                 relation: {"public", "single_pk"},
                 record: %{
                   "id" => "471a929e-3e8e-419c-a6d2-9ab3f32294d2",
                   "owner" => "bba4358f-7ba7-41a2-b32c-d8f145f16f41",
                   "value" => "something",
                   "amount" => "3"
                 }
               },
               cxt.schema
             )

    assert :ok =
             ImmutablePrimaryKey.validate_insert(
               %Changes.NewRecord{
                 relation: {"public", "compound_pk"},
                 record: %{
                   "id" => "471a929e-3e8e-419c-a6d2-9ab3f32294d2",
                   "value" => "something",
                   "amount" => "3"
                 }
               },
               cxt.schema
             )
  end

  test "allows deletes", cxt do
    assert :ok =
             ImmutablePrimaryKey.validate_delete(
               %Changes.DeletedRecord{
                 relation: {"public", "single_pk"},
                 old_record: %{
                   "id" => "471a929e-3e8e-419c-a6d2-9ab3f32294d2",
                   "value" => "something",
                   "amount" => "3"
                 }
               },
               cxt.schema
             )

    assert :ok =
             ImmutablePrimaryKey.validate_delete(
               %Changes.DeletedRecord{
                 relation: {"public", "compound_pk"},
                 old_record: %{
                   "id" => "471a929e-3e8e-419c-a6d2-9ab3f32294d2",
                   "owner" => "bba4358f-7ba7-41a2-b32c-d8f145f16f41",
                   "value" => "something",
                   "amount" => "3"
                 }
               },
               cxt.schema
             )
  end

  test "allows updates that don't affect a primary key", cxt do
    assert :ok =
             ImmutablePrimaryKey.validate_update(
               Changes.UpdatedRecord.new(
                 relation: {"public", "single_pk"},
                 record: %{
                   "id" => "471a929e-3e8e-419c-a6d2-9ab3f32294d2",
                   "value" => "something",
                   "amount" => "3"
                 },
                 old_record: %{
                   "id" => "471a929e-3e8e-419c-a6d2-9ab3f32294d2",
                   "value" => "something else",
                   "amount" => "4"
                 }
               ),
               cxt.schema
             )

    assert :ok =
             ImmutablePrimaryKey.validate_update(
               Changes.UpdatedRecord.new(
                 relation: {"public", "compound_pk"},
                 old_record: %{
                   "id" => "471a929e-3e8e-419c-a6d2-9ab3f32294d2",
                   "owner" => "bba4358f-7ba7-41a2-b32c-d8f145f16f41",
                   "value" => "something",
                   "amount" => "3"
                 },
                 record: %{
                   "id" => "471a929e-3e8e-419c-a6d2-9ab3f32294d2",
                   "owner" => "bba4358f-7ba7-41a2-b32c-d8f145f16f41",
                   "value" => "something else",
                   "amount" => "4"
                 }
               ),
               cxt.schema
             )
  end

  test "allows upserts", cxt do
    assert :ok =
             ImmutablePrimaryKey.validate_update(
               Changes.UpdatedRecord.new(
                 relation: {"public", "single_pk"},
                 old_record: nil,
                 record: %{
                   "id" => "471a929e-3e8e-419c-a6d2-9ab3f32294d2",
                   "value" => "something",
                   "amount" => "3"
                 }
               ),
               cxt.schema
             )

    assert :ok =
             ImmutablePrimaryKey.validate_update(
               Changes.UpdatedRecord.new(
                 relation: {"public", "compound_pk"},
                 old_record: nil,
                 record: %{
                   "id" => "471a929e-3e8e-419c-a6d2-9ab3f32294d2",
                   "owner" => "bba4358f-7ba7-41a2-b32c-d8f145f16f41",
                   "value" => "something else",
                   "amount" => "4"
                 }
               ),
               cxt.schema
             )
  end

  test "disallows updates that affect a primary key", cxt do
    assert {:error, _} =
             ImmutablePrimaryKey.validate_update(
               Changes.UpdatedRecord.new(
                 relation: {"public", "single_pk"},
                 old_record: %{
                   "id" => "f0847f32-d9a5-4006-b9f3-f715654ca0a7",
                   "value" => "something else",
                   "amount" => "4"
                 },
                 record: %{
                   "id" => "471a929e-3e8e-419c-a6d2-9ab3f32294d2",
                   "value" => "something",
                   "amount" => "3"
                 }
               ),
               cxt.schema
             )

    assert {:error, _} =
             ImmutablePrimaryKey.validate_update(
               Changes.UpdatedRecord.new(
                 relation: {"public", "compound_pk"},
                 old_record: %{
                   "id" => "471a929e-3e8e-419c-a6d2-9ab3f32294d2",
                   "owner" => "bba4358f-7ba7-41a2-b32c-d8f145f16f41",
                   "value" => "something",
                   "amount" => "3"
                 },
                 record: %{
                   "id" => "7ba5e710-7f88-475b-885a-5b33d68e5975",
                   "owner" => "a6c6bba1-dbc7-4624-a2b0-512212b8f814",
                   "value" => "something else",
                   "amount" => "4"
                 }
               ),
               cxt.schema
             )
  end

  test "disallows updates to any column in a compound pk", cxt do
    assert {:error, _} =
             ImmutablePrimaryKey.validate_update(
               Changes.UpdatedRecord.new(
                 relation: {"public", "compound_pk"},
                 old_record: %{
                   "id" => "471a929e-3e8e-419c-a6d2-9ab3f32294d2",
                   "owner" => "bba4358f-7ba7-41a2-b32c-d8f145f16f41",
                   "value" => "something",
                   "amount" => "3"
                 },
                 record: %{
                   "id" => "471a929e-3e8e-419c-a6d2-9ab3f32294d2",
                   "owner" => "a6c6bba1-dbc7-4624-a2b0-512212b8f814",
                   "value" => "something else",
                   "amount" => "4"
                 }
               ),
               cxt.schema
             )
  end
end
