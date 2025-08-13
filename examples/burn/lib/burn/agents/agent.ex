defmodule Burn.Agents.Agent do
  @moduledoc """
  Shared behavior for agent GenServers.
  """

  # Callbacks - must be implemented by each agent

  @callback handle_instruct(State.t()) :: {:ok, any(), State.t()}
  @callback should_instruct(list(), State.t()) :: boolean()

  # Shared implementation

  defmacro __using__(_opts \\ []) do
    quote do
      use GenServer

      alias Burn.{
        Accounts,
        Agents,
        Consumer,
        Messages,
        Shapes,
        Threads
      }

      @behaviour Agents.Agent

      @type next_step ::
              {:ok, Ecto.Schema.t()}
              | {:error, Ecto.Changeset.t()}
              | {:error, any()}
              | {:error, atom(), any()}

      defmodule State do
        defstruct [
          :agent,
          :events,
          :event_id_set,
          :mode,
          :thread,
          :users
        ]
      end

      # Client API

      @spec start_link(Threads.Thread.t(), Accounts.User.t(), atom()) :: GenServer.on_start()
      def start_link(
            %Threads.Thread{} = thread,
            %Accounts.User{type: :agent} = agent,
            mode \\ :auto
          ) do
        GenServer.start_link(__MODULE__, {thread, agent, mode}, name: process_name(thread))
      end

      @spec instruct(Threads.Thread.t()) :: next_step()
      def instruct(%Threads.Thread{} = thread) do
        call_thread(thread, :instruct)
      end

      @spec get_state(Threads.Thread.t()) :: State.t()
      def get_state(%Threads.Thread{} = thread) do
        call_thread(thread, :get_state)
      end

      def process_name(%Threads.Thread{id: thread_id}) do
        {:via, Registry, {Agents, {__MODULE__, thread_id}}}
      end

      defp call_thread(%Threads.Thread{} = thread, request) do
        thread
        |> process_name()
        |> GenServer.call(request, 30_000)
      end

      # GenServer callbacks

      @impl true
      def init({%Threads.Thread{} = thread, %Accounts.User{type: :agent} = agent, mode}) do
        pid = self()
        {:ok, supervisor} = Task.Supervisor.start_link()

        shapes = [
          {:events, start_shape(thread, :events)},
          {:memberships, start_shape(thread, :memberships)},
          {:thread, start_shape(thread, :thread)}
        ]

        Enum.each(shapes, fn {key, shape} ->
          Task.Supervisor.start_child(
            supervisor,
            fn -> Consumer.consume(pid, key, shape) end,
            restart: :permanent
          )
        end)

        state = %State{
          agent: agent,
          events: [],
          event_id_set: MapSet.new(),
          mode: mode,
          thread: thread,
          users: []
        }

        {:ok, state}
      end

      defp start_shape(%Threads.Thread{} = thread, :events), do: Shapes.events(thread)
      defp start_shape(%Threads.Thread{} = thread, :memberships), do: Shapes.memberships(thread)
      defp start_shape(%Threads.Thread{} = thread, :thread), do: Shapes.thread(thread)

      @impl true
      def handle_info({:stream, :thread, []}, state), do: {:noreply, state}

      def handle_info({:stream, :thread, _messages}, %{thread: %{id: thread_id}} = state) do
        {:noreply, %{state | thread: Threads.get_thread!(thread_id)}}
      end

      @impl true
      def handle_info({:stream, :events, []}, state), do: {:noreply, state}

      @impl true
      def handle_info(
            {:stream, :events, messages},
            %{events: events, event_id_set: event_id_set} = state
          ) do
        messages
        |> Enum.filter(&Messages.is_insert/1)
        |> Enum.map(&Messages.get_value/1)
        |> Enum.reject(fn %{id: event_id} -> MapSet.member?(event_id_set, event_id) end)
        |> case do
          [] ->
            {:noreply, state}

          new_events ->
            if __MODULE__.should_instruct(new_events, state) do
              Process.send(self(), :instruct, [])
            end

            new_event_ids = MapSet.new(new_events, & &1.id)
            updated_event_id_set = MapSet.union(event_id_set, new_event_ids)

            {:noreply,
             %{state | events: events ++ new_events, event_id_set: updated_event_id_set}}
        end
      end

      @impl true
      def handle_info({:stream, :memberships, []}, state), do: {:noreply, state}

      def handle_info({:stream, :memberships, _messages}, %{thread: thread} = state) do
        {:noreply, %State{state | users: Accounts.get_users_for_thread(thread)}}
      end

      @impl true
      def handle_info(:instruct, state) do
        {:ok, _result, state} = __MODULE__.handle_instruct(state)

        {:noreply, state}
      end

      @impl true
      def handle_call(:instruct, _from, state) do
        {:ok, result, state} = __MODULE__.handle_instruct(state)

        {:reply, result, state}
      end

      @impl true
      def handle_call(:get_state, _from, state) do
        {:reply, state, state}
      end

      # Utilities

      defp joke_has_been_told(events) do
        Enum.any?(events, &is_tool_use(&1, "roast_user"))
      end

      defp contains_fact_extraction_since(reversed_events, last_joke_event) do
        with %Threads.Event{id: event_id} <- last_joke_event,
             index when not is_nil(index) <-
               Enum.find_index(reversed_events, fn %{id: id} -> id == event_id end) do
          reversed_events
          |> Enum.split(index)
          |> elem(0)
        else
          _ ->
            reversed_events
        end
        |> Enum.any?(&is_tool_use(&1, "extract_facts"))
      end

      defp did_not_tell_the_last_joke(reversed_events, %{id: agent_id, name: agent_name}) do
        reversed_events
        |> Enum.find(&is_tool_use(&1, "roast_user"))
        |> case do
          %{user_id: ^agent_id} = last_joke_event ->
            {false, last_joke_event}

          last_joke_event ->
            {true, last_joke_event}
        end
      end

      defp is_tool_use(%{type: :tool_use, data: %{"name" => a}}, b) when a == b, do: true
      defp is_tool_use(_, _), do: false
    end
  end
end
