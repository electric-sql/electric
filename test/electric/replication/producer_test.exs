defmodule Electric.Replication.ProducerTest do
  use ExUnit.Case, async: true
  import Mox

  alias Electric.Replication.Producer
  alias Electric.Replication.Changes.{NewRecord, UpdatedRecord}
  alias Electric.Postgres.LogicalReplication
  alias Electric.Postgres.LogicalReplication.Messages

  setup _ do
    stub(Electric.Replication.MockPostgresClient, :connect_and_start_replication, fn _ ->
      {:ok, nil}
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

    assert [{transaction, _, _}] = events
    assert [%NewRecord{record: %{"id" => "test", "data" => "value"}}] = transaction.changes
  end

  def initialize_producer(demand \\ 100) do
    {:producer, state} = Producer.init(nil)
    {_, _, state} = Producer.handle_demand(10, state)
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
      lsn: %Messages.Lsn{segment: Enum.random(0..0xFF), offset: Enum.random(1..0xFFFFFFFF)},
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
