defmodule Burn.Ingest do
  @moduledoc """
  Ingest specific validation and event handling functions.
  """

  alias Burn.{
    Accounts,
    Threads
  }

  alias Ecto.{
    Changeset,
    Multi
  }

  alias Phoenix.Sync.Writer
  alias Phoenix.Sync.Writer.Operation

  # Check functions validate the params against the current user

  @doc """
  Authorize event inserts.

  Users are only allowed to insert events they made, in threads
  that they're in.

  Note that events are immutable, so we only support (and thus
  need to authorize) inserts.
  """
  def check_event(
        %Operation{operation: :insert, changes: %{"thread_id" => thread_id, "user_id" => user_id}},
        %Accounts.User{id: current_user_id}
      ) when user_id == current_user_id do
    case Threads.is_member?(thread_id, user_id) do
      true ->
        :ok

      false ->
        {:error, "user not in thread"}
    end
  end

  def check_event(_op, _user), do:  {:error, "not authorized"}

  @doc """
  Authorize membership inserts.

  Users are only allowed to join threads themselves. They can't enroll
  other users in threads.
  """
  def check_membership(
        %Operation{operation: :insert, changes: %{"thread_id" => thread_id, "user_id" => user_id}},
        %Accounts.User{id: current_user_id}
      ) when user_id == current_user_id do
    case Threads.is_member?(thread_id, user_id) do
      false ->
        :ok

      true ->
        {:error, "user already in thread"}
    end
  end

  def check_membership(%Operation{operation: :insert}, %Accounts.User{}) do
    {:error, "not authorized"}
  end

  def check_membership(_op, _user), do: :ok

  @doc """
  Authorize membership deletes.

  Users are only allowed to leave threads themselves. Thread owners can
  also boot out other users they don't like.
  """
  def load_membership(%{"id" => membership_id}, %Accounts.User{id: current_user_id}) do
    case Threads.get_membership(membership_id) do
      %Threads.Membership{user_id: ^current_user_id} ->
        :ok

      %Threads.Membership{thread_id: thread_id} = membership ->
        case Threads.is_owner?(thread_id, current_user_id) do
          true ->
            membership

          false ->
            {:error, "not authorized"}
        end

      _ ->
        {:error, "not found"}
    end
  end

  @doc """
  You have to be in a thread to update it.
  """
  def load_thread(%{"id" => thread_id}, %Accounts.User{id: current_user_id}) do
    case Threads.is_member?(thread_id, current_user_id) do
      true ->
        Threads.get_thread(thread_id)

      false ->
        {:error, "not authorized"}
    end
  end

  # When a new thread is created:
  # - record the user created event
  # - add the agents to the thread
  def on_insert_thread(
        %Multi{} = multi,
        %Changeset{changes: %{id: thread_id}},
        %Writer.Context{} = context,
        %Accounts.User{id: user_id, type: user_type}
      ) do
    event = Threads.init_user_thread_event(thread_id, user_id, user_type, :created)
    event_key = Writer.operation_name(context, :user_created_thread_event)

    sarah_membership = Accounts.init_agent_membership(thread_id, "sarah", :producer)
    sarah_membership_key = Writer.operation_name(context, :sarah_thread_membership)

    jerry_membership = Accounts.init_agent_membership(thread_id, "jerry", :comedian)
    jerry_membership_key = Writer.operation_name(context, :jerry_thread_membership)

    frankie_membership = Accounts.init_agent_membership(thread_id, "frankie", :comedian)
    frankie_membership_key = Writer.operation_name(context, :frankie_thread_membership)

    multi
    |> Multi.insert(event_key, event)
    |> Multi.insert(sarah_membership_key, sarah_membership)
    |> Multi.insert(jerry_membership_key, jerry_membership)
    |> Multi.insert(frankie_membership_key, frankie_membership)
  end

  # When a users joins a thread:
  # - record the user joined event
  def on_insert_membership(
        %Multi{} = multi,
        %Changeset{changes: %{role: role, thread_id: thread_id, user_id: user_id}},
        %Writer.Context{} = context,
        %Accounts.User{id: current_user_id, type: user_type}
      ) do
    case {role, user_id} do
      {:member, ^current_user_id} ->
        event = Threads.init_user_thread_event(thread_id, user_id, user_type, :joined)
        event_key = Writer.operation_name(context, :user_joined_thread_event)

        multi
        |> Multi.insert(event_key, event)

      {_role, _user_id} ->
        multi
    end
  end
end
