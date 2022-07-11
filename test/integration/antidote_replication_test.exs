defmodule Electric.Integration.AntidoteReplicationTest do
  use ExUnit.Case, async: false

  @moduletag :integration

  alias Electric.VaxRepo
  alias Electric.Replication.Row

  # Test helpers
  alias Electric.Entry
  alias Electric.PostgresRepo

  setup_all do
    {:ok, _pid} = start_supervised(PostgresRepo)

    {:ok, _pid} =
      start_supervised(
        {Electric.Replication,
         [
           producer: Electric.Replication.Producer,
           pg_client: Electric.Replication.PostgresClient,
           name: __MODULE__
         ]}
      )

    :ok
  end

  test "creating an entity in postgres replicates to antidote" do
    {:ok, entry} = PostgresRepo.insert(%Entry{content: "a"}, returning: [:id])

    # TODO: synchronization?
    :timer.sleep(200)

    assert vax_entry = VaxRepo.get(Row, vax_id(entry))
    assert vax_entry.row["content"] == "a"
    assert vax_entry.schema == "public"
    assert vax_entry.table == "entries"
  end

  test "updating an entity in postgres replicates to antidote" do
    {:ok, entry} = PostgresRepo.insert(%Entry{content: "a"}, returning: [:id])
    {:ok, _} = entry |> Ecto.Changeset.change(content: "b") |> PostgresRepo.update()

    # TODO: synchronization?
    :timer.sleep(200)
    assert vax_entry = VaxRepo.get(Row, vax_id(entry))
    assert vax_entry.row["content"] == "b"
  end

  test "deleting an entity in postgres replicates to antidote" do
    {:ok, entry} = PostgresRepo.insert(%Entry{content: "a"}, returning: [:id])
    {:ok, _} = entry |> PostgresRepo.delete()

    # TODO: synchronization?
    :timer.sleep(200)

    assert vax_entry = VaxRepo.get(Row, vax_id(entry))
    assert vax_entry.deleted?
  end

  def vax_id(%mod{} = schema) do
    source = mod.__schema__(:source)
    prefix = mod.__schema__(:prefix) || "public"
    Row.new(prefix, source, schema).id
  end
end
