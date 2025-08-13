defmodule Burn.ThreadsFixtures do
  @moduledoc """
  This module defines test helpers for creating
  entities via the `Burn.Threads` context.
  """

  alias Burn.Accounts
  alias Burn.Threads

  @doc """
  Generate a thread.
  """
  def thread_fixture(attrs \\ %{}) do
    {:ok, thread} =
      attrs
      |> Enum.into(%{
        name: "some name",
        status: :started
      })
      |> Threads.create_thread()

    thread
  end

  @doc """
  Generate a event.
  """
  def event_fixture(%Threads.Thread{} = thread, %Accounts.User{} = user, attrs \\ %{}) do
    {:ok, event} =
      Threads.create_event(
        thread,
        user,
        Enum.into(
          attrs,
          %{
            type: :text,
            data: %{
              "text" => "Lorem ipsum"
            }
          }
        )
      )

    event
  end

  @doc """
  Generate a membership.
  """
  def membership_fixture(%Threads.Thread{} = thread, %Accounts.User{} = user, role \\ :owner) do
    {:ok, membership} = Burn.Threads.create_membership(thread, user, role)

    membership
  end

  def user_created_event_fixture(
        %Threads.Thread{} = thread,
        %Accounts.User{type: :human} = user
      ) do
    attrs = %{
      type: :text,
      data: %{
        "text" => "User created this thread!"
      }
    }

    {:ok, event} = Threads.create_event(thread, user, attrs)

    event
  end

  # def user_joined_event_fixture(%Threads.Thread{} = thread, %Accounts.User{} = user) do
  #   attrs = %{
  #     role: :user,
  #     user_id: user_id,
  #     type: :text,
  #     data: %{
  #       "text" => "User joined this thread!"
  #     }
  #   }
  #
  #   {:ok, event} = Threads.create_event(thread, user, attrs)
  #
  #   event
  # end

  def ask_user_about_themselves_fixture(
        %Threads.Thread{} = thread,
        %Accounts.User{type: :agent} = agent,
        %Accounts.User{type: :human, id: subject_id}
      ) do
    tool_use_id = Ecto.UUID.generate()

    attrs = %{
      type: :tool_use,
      data: %{
        "id" => tool_use_id,
        "input" => %{
          "subject" => subject_id,
          "question" => "What's something unique or interesting about yourself?"
        },
        "name" => "ask_user_about_themselves"
      }
    }

    {:ok, event} = Threads.create_event(thread, agent, attrs)

    event
  end

  def user_provides_information_fixture(
        %Threads.Thread{} = thread,
        %Accounts.User{type: :human} = user
      ) do
    attrs = %{
      type: :text,
      data: %{
        "text" => "I like horse riding and I hate biscuits"
      }
    }

    {:ok, event} = Threads.create_event(thread, user, attrs)

    event
  end
end
