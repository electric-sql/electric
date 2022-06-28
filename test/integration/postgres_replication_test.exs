defmodule Electric.Integration.PostgresReplicationTest do
  use ExUnit.Case, async: false

  @moduletag :integration

  # Test helpers
  alias Electric.Entry
  alias Electric.PostgresRepo
  alias Electric.PostgresRepo2

  setup_all do
    {:ok, _pid} = start_supervised(PostgresRepo)
    {:ok, _pid} = start_supervised(PostgresRepo2)

    case PostgresRepo2.query!(
           "SELECT subenabled from pg_subscription where subname = 'test_subscription'"
         ) do
      %Postgrex.Result{rows: [[true]]} ->
        %Postgrex.Result{} = PostgresRepo2.query!("DROP SUBSCRIPTION test_subscription")

      %Postgrex.Result{rows: [[false]]} ->
        :ok
    end

    %Postgrex.Result{} =
      PostgresRepo2.query!(
        "CREATE SUBSCRIPTION test_subscription CONNECTION 'host=host.docker.internal port=5433' PUBLICATION all_tables"
      )

    :ok
  end

  test "changes on postgres1 are replicated to postgres2" do
    %{id: id} = PostgresRepo.insert!(%Entry{content: "a"}, returning: [:id])

    :timer.sleep(200)

    assert %Entry{content: "a"} = PostgresRepo2.get(Entry, id)
  end
end
