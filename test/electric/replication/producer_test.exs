defmodule Electric.Replication.ProducerTest do
  use ExUnit.Case, async: true
  import Mox

  alias Electric.Replication.Producer
  alias Electric.Replication.Changes.{NewRecord, UpdatedRecord}
  alias Electric.Postgres.LogicalReplication
  alias Electric.Postgres.LogicalReplication.Messages
  alias Electric.Postgres.Lsn

  setup _ do
    stub(Electric.Replication.MockPostgresClient, :connect_and_start_replication, fn _ ->
      info = %{
        tables: [
          %{
            schema: "public",
            name: "entities",
            oid: 0,
            replica_identity: :all_columns,
            columns: [%{name: "entities"}]
          }
        ],
        database: "postgres",
        publication: "stub",
        connection: nil
      }

      {:ok, info}
    end)

    :ok
  end

  test "Producer complies a transaction into a single message" do
    {_, events} =
      begin()
      |> relation("entities", id: :uuid, data: :varchar)
      |> insert("entities", {"test", "value"})
      |> commit_and_get_messages()
      |> process_messages(initialize_producer(), &Producer.handle_info/2)

    assert [%Broadway.Message{data: transaction}] = events
    assert [%NewRecord{record: %{"id" => "test", "data" => "value"}}] = transaction.changes
  end

  test "Producer keeps proper ordering of updates within the transaction for inserts" do
    {_, events} =
      begin()
      |> relation("entities", id: :uuid, data: :varchar)
      |> insert("entities", {"test1", "value"})
      |> insert("entities", {"test2", "value"})
      |> insert("entities", {"test3", "value"})
      |> insert("entities", {"test4", "value"})
      |> commit_and_get_messages()
      |> process_messages(initialize_producer(), &Producer.handle_info/2)

    assert [%Broadway.Message{data: transaction}] = events
    assert length(transaction.changes) == 4

    assert [
             %NewRecord{record: %{"id" => "test1"}},
             %NewRecord{record: %{"id" => "test2"}},
             %NewRecord{record: %{"id" => "test3"}},
             %NewRecord{record: %{"id" => "test4"}}
           ] = transaction.changes
  end

  test "Producer keeps proper ordering of updates within the transaction for updates" do
    {_, events} =
      begin()
      |> relation("entities", id: :uuid, data: :varchar)
      |> insert("entities", {"test", "1"})
      |> update("entities", {"test", "1"}, {"test", "2"})
      |> update("entities", {"test", "2"}, {"test", "3"})
      |> update("entities", {"test", "3"}, {"test", "4"})
      |> update("entities", {"test", "4"}, {"test", "5"})
      |> commit_and_get_messages()
      |> process_messages(initialize_producer(), &Producer.handle_info/2)

    assert [%Broadway.Message{data: transaction}] = events
    assert length(transaction.changes) == 5

    assert [
             %NewRecord{record: %{"data" => "1"}},
             %UpdatedRecord{record: %{"data" => "2"}, old_record: %{"data" => "1"}},
             %UpdatedRecord{record: %{"data" => "3"}, old_record: %{"data" => "2"}},
             %UpdatedRecord{record: %{"data" => "4"}, old_record: %{"data" => "3"}},
             %UpdatedRecord{record: %{"data" => "5"}, old_record: %{"data" => "4"}}
           ] = transaction.changes
  end

  def initialize_producer(demand \\ 100) do
    {:producer, state} = Producer.init(pg_client: Electric.Replication.MockPostgresClient)
    {_, _, state} = Producer.handle_demand(demand, state)
    state
  end

  defp process_messages(messages, initial_state, gen_stage_callback)
       when is_function(gen_stage_callback, 2) do
    Enum.reduce(messages, {initial_state, []}, fn msg, {state, events} ->
      {:noreply, new_events, new_state} = gen_stage_callback.(msg, state)
      {new_state, events ++ new_events}
    end)
  end

  defp begin() do
    %{
      lsn: %Lsn{segment: Enum.random(0..0xFF), offset: Enum.random(1..0xFFFFFFFF)},
      actions: [],
      relations: %{}
    }
  end

  defp relation(state, name, columns) do
    relation_id = Enum.random(0..0xFFFFFFFF)

    state
    |> Map.update!(:relations, &Map.put(&1, name, relation_id))
    |> add_action(%Messages.Relation{
      id: relation_id,
      name: name,
      replica_identity: :all_columns,
      namespace: "public",
      columns:
        Enum.map(columns, fn
          {name, type} when is_atom(type) ->
            %Messages.Relation.Column{
              flags: [],
              name: Atom.to_string(name),
              type: type,
              type_modifier: 0
            }

          {name, {type, :key}} ->
            %Messages.Relation.Column{
              flags: [:key],
              name: Atom.to_string(name),
              type: type,
              type_modifier: 0
            }
        end)
    })
  end

  defp insert(state, relation, data) do
    add_action(state, %Messages.Insert{
      relation_id: Map.fetch!(state.relations, relation),
      tuple_data: data
    })
  end

  defp update(state, relation, old_record, data) when is_tuple(old_record) do
    add_action(state, %Messages.Update{
      relation_id: Map.fetch!(state.relations, relation),
      old_tuple_data: old_record,
      tuple_data: data
    })
  end

  defp commit_and_get_messages(%{lsn: lsn, actions: actions}) do
    timestamp = DateTime.utc_now()
    begin = %Messages.Begin{xid: lsn.segment, final_lsn: lsn, commit_timestamp: timestamp}

    commit = %Messages.Commit{
      commit_timestamp: timestamp,
      lsn: lsn,
      end_lsn: Map.update!(lsn, :offset, &(&1 + 30)),
      flags: []
    }

    ([begin] ++ actions ++ [commit])
    |> Enum.map(&LogicalReplication.encode_message/1)
    |> Enum.map(&{:epgsql, self(), {:x_log_data, 0, 0, &1}})
  end

  defp add_action(state, action), do: Map.update!(state, :actions, &(&1 ++ [action]))
end
