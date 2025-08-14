defmodule Burn.Agents.Supervisor do
  @moduledoc """
  DynamicSupervisor that manages agent processes.

  Uses Electric to monitor thread memberships. Ensuring that every
  agent in every thread is running as a GenServer process.
  """
  use GenServer
  require Logger

  alias Burn.{
    Accounts,
    Agents,
    Consumer,
    Messages,
    Repo,
    Threads
  }

  @agents %{
    "frankie" => Agents.Frankie,
    "jerry" => Agents.Jerry,
    "sarah" => Agents.Sarah
    # ...
  }

  # Client API

  @spec start_link(keyword()) :: GenServer.on_start()
  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  # Server callbacks

  @impl true
  def init(_opts) do
    pid = self()

    # Don't spam the LLM with loads of old threads on startup
    {:ok, _counts} = Burn.Cleanup.threads_older_than(30, :minute)

    {:ok, supervisor} = DynamicSupervisor.start_link(strategy: :one_for_one)
    {:ok, _consumer} =
      DynamicSupervisor.start_child(supervisor, %{
        id: :membership_consumer,
        start: {Task, :start_link, [fn -> sync_memberships(pid) end]},
        restart: :permanent
      })

    {:ok, %{supervisor: supervisor}}
  end

  @impl true
  def handle_info({:stream, :memberships, []}, state), do: {:noreply, state}

  @doc """
  When agents join a thread, start their process. When they leave, stop it.

  Note that thread and user deletion cascades. So if the thread is deleted
  or the user is deleted, the membership is also deleted.
  """
  @impl true
  def handle_info({:stream, :memberships, messages}, state) do
    # Stop process when agent membership deleted
    messages
    |> Enum.filter(&Messages.is_delete/1)
    |> Enum.map(&Messages.get_value/1)
    |> Enum.map(&preload_associations/1)
    |> Enum.filter(&is_agent_membership?/1)
    |> Enum.each(&stop_agent(&1, state))

    # Start process when agent membership inserted
    messages
    |> Enum.filter(&Messages.is_insert/1)
    |> Enum.map(&Messages.get_value/1)
    |> Enum.map(&preload_associations/1)
    |> Enum.filter(&is_agent_membership?/1)
    |> Enum.each(&start_agent(&1, state))

    {:noreply, state}
  end

  # Private functions

  defp sync_memberships(pid) do
    Consumer.consume(pid, :memberships, Threads.Membership)
  end

  defp preload_associations(%Threads.Membership{} = membership) do
    Repo.preload(membership, [:thread, :user])
  end

  defp is_agent_membership?(%Threads.Membership{
         user: %Accounts.User{type: :agent, name: agent_name}
       }) do
    Map.has_key?(@agents, agent_name)
  end

  defp is_agent_membership?(_), do: false

  defp start_agent(
         %Threads.Membership{
           thread: %Threads.Thread{id: thread_id} = thread,
           user: %Accounts.User{name: agent_name} = user
         },
         %{supervisor: supervisor}
       ) do
    agent_module = Map.fetch!(@agents, agent_name)

    child_spec = %{
      id: agent_module.process_name(thread),
      start: {agent_module, :start_link, [thread, user]},
      restart: :transient
    }

    result =
      case DynamicSupervisor.start_child(supervisor, child_spec) do
        {:ok, _pid} ->
          :ok

        {:error, {:already_started, _pid}} ->
          :ok

        {:error, reason} ->
          Logger.error(
            "Failed to start agent #{agent_name} for thread #{thread_id}: #{inspect(reason)}"
          )

          :error
      end

    result
  end

  defp stop_agent(
         %Threads.Membership{
           thread: %Threads.Thread{id: thread_id} = thread,
           user: %Accounts.User{name: agent_name}
         },
         %{supervisor: supervisor}
       ) do
    agent_module = Map.fetch!(@agents, agent_name)
    child_id = agent_module.process_name(thread)

    case DynamicSupervisor.terminate_child(supervisor, child_id) do
      :ok ->
        :ok

      {:error, :not_found} ->
        :ok

      {:error, reason} ->
        Logger.error(
          "Failed to stop agent #{agent_name} for thread #{thread_id}: #{inspect(reason)}"
        )

        :error
    end
  end
end
