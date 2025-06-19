defmodule Electric.Client.EctoAdapter.EnumDecodingTest do
  use ExUnit.Case, async: true

  alias Electric.Client
  alias Electric.Client.Message

  import Support.DbSetup
  import Ecto.Query, only: [from: 2]

  defmodule Event do
    use Ecto.Schema

    schema "events" do
      field(:category, Ecto.Enum,
        values: [:hobby, :business, :self_improvement, :art, :sports, :cooking, :music, :other]
      )

      field(:status, Ecto.Enum, values: [:draft, :published, :ended], default: :draft)
    end
  end

  setup do
    {:ok, client} = Client.new(base_url: Application.fetch_env!(:electric_client, :electric_url))

    [client: client]
  end

  setup do
    {:ok, _} = start_supervised(Support.Repo)

    table_name = "test_table_#{<<System.monotonic_time(:microsecond)::64>> |> Base.encode16()}"

    columns = [
      {"id", "serial8 primary key not null"},
      {"category", "text"},
      {"status", "text default 'draft' not null"}
    ]

    with_table(table_name, columns)
  end

  # looks for regressions matching: https://github.com/electric-sql/phoenix_sync/issues/63
  test "correctly maps enum columns", ctx do
    parent = self()

    query =
      from(e in {ctx.tablename, Event},
        where: e.status == :published and e.category == :self_improvement
      )

    stream = Client.stream(ctx.client, query)

    {:ok, _task} =
      start_supervised(
        {Task,
         fn ->
           stream
           |> Stream.each(&send(parent, {:stream, &1}))
           |> Stream.run()
         end}
      )

    value1 =
      %Event{
        id: 1,
        category: :self_improvement,
        status: :published
      }
      |> Ecto.put_meta(source: ctx.tablename)

    Support.Repo.insert(value1)

    assert_receive {:stream, %Message.ControlMessage{control: :up_to_date}}, 5000
    assert_receive {:stream, %Message.ChangeMessage{} = message}, 5000

    assert %{
             id: 1,
             category: :self_improvement,
             status: :published
           } = message.value
  end
end
