defmodule Burn.ThreadsTest do
  use Burn.DataCase

  alias Burn.Threads

  describe "threads" do
    alias Burn.Threads.Thread

    import Burn.ThreadsFixtures

    @invalid_attrs %{name: nil, status: nil}

    test "list_threads/0 returns all threads" do
      thread = thread_fixture()
      assert Threads.list_threads() == [thread]
    end

    test "get_thread!/1 returns the thread with given id" do
      thread = thread_fixture()
      assert Threads.get_thread!(thread.id) == thread
    end

    test "create_thread/1 with valid data creates a thread" do
      valid_attrs = %{name: "some name", status: :completed}

      assert {:ok, %Thread{} = thread} = Threads.create_thread(valid_attrs)
      assert thread.name == "some name"
      assert thread.status == :completed
    end

    test "create_thread/1 with invalid data returns error changeset" do
      assert {:error, %Ecto.Changeset{}} = Threads.create_thread(@invalid_attrs)
    end

    test "update_thread/2 with valid data updates the thread" do
      thread = thread_fixture()
      update_attrs = %{name: "some updated name", status: :started}

      assert {:ok, %Thread{} = thread} = Threads.update_thread(thread, update_attrs)
      assert thread.name == "some updated name"
      assert thread.status == :started
    end

    test "update_thread/2 with invalid data returns error changeset" do
      thread = thread_fixture()
      assert {:error, %Ecto.Changeset{}} = Threads.update_thread(thread, @invalid_attrs)
      assert thread == Threads.get_thread!(thread.id)
    end

    test "delete_thread/1 deletes the thread" do
      thread = thread_fixture()
      assert {:ok, %Thread{}} = Threads.delete_thread(thread)
      assert_raise Ecto.NoResultsError, fn -> Threads.get_thread!(thread.id) end
    end

    test "change_thread/1 returns a thread changeset" do
      thread = thread_fixture()
      assert %Ecto.Changeset{} = Threads.change_thread(thread)
    end
  end

  describe "events" do
    alias Burn.Threads.Event

    import Burn.AccountsFixtures
    import Burn.ThreadsFixtures

    @invalid_attrs %{data: nil}

    setup do
      %{thread: thread_fixture(), user: user_fixture()}
    end

    test "list_events/0 returns all events", %{thread: thread, user: user} do
      event = event_fixture(thread, user)
      assert Threads.list_events() == [event]
    end

    test "get_event!/1 returns the event with given id", %{thread: thread, user: user} do
      event = event_fixture(thread, user)
      assert Threads.get_event!(event.id) == event
    end

    test "create_event/1 with valid data creates a event", %{thread: thread, user: user} do
      valid_attrs = %{
        type: :text,
        data: %{
          text: "Lorem ipsum"
        }
      }

      assert {:ok, %Event{} = event} = Threads.create_event(thread, user, valid_attrs)
      assert :text = event.type
      assert %{text: "Lorem ipsum"} = event.data
    end

    test "create_event/1 with invalid data returns error changeset", %{thread: thread, user: user} do
      assert {:error, %Ecto.Changeset{}} = Threads.create_event(thread, user, @invalid_attrs)
    end

    test "update_event/2 with valid data updates the event", %{thread: thread, user: user} do
      event = event_fixture(thread, user)
      update_attrs = %{data: %{"text" => "Lala"}}

      assert {:ok, %Event{} = event} = Threads.update_event(event, update_attrs)
      assert event.data == %{"text" => "Lala"}
    end

    test "update_event/2 with invalid data returns error changeset", %{thread: thread, user: user} do
      event = event_fixture(thread, user)
      assert {:error, %Ecto.Changeset{}} = Threads.update_event(event, @invalid_attrs)
      assert event == Threads.get_event!(event.id)
    end

    test "delete_event/1 deletes the event", %{thread: thread, user: user} do
      event = event_fixture(thread, user)
      assert {:ok, %Event{}} = Threads.delete_event(event)
      assert_raise Ecto.NoResultsError, fn -> Threads.get_event!(event.id) end
    end

    test "change_event/1 returns a event changeset", %{thread: thread, user: user} do
      event = event_fixture(thread, user)
      assert %Ecto.Changeset{} = Threads.change_event(event)
    end
  end

  describe "memberships" do
    alias Burn.Threads.Membership

    import Burn.AccountsFixtures
    import Burn.ThreadsFixtures

    setup do
      %{thread: thread_fixture(), user: user_fixture()}
    end

    @invalid_attrs %{
      # valid UUID but not a valid fkey
      thread_id: Ecto.UUID.generate()
    }

    test "list_memberships/0 returns all memberships", %{thread: thread, user: user} do
      membership = membership_fixture(thread, user)
      assert Threads.list_memberships() == [membership]
    end

    test "get_membership!/1 returns the membership with given id", %{thread: thread, user: user} do
      membership = membership_fixture(thread, user)
      assert Threads.get_membership!(membership.id) == membership
    end

    test "create_membership/1 with valid data creates a membership", %{thread: thread, user: user} do
      assert {:ok, %Membership{}} = Threads.create_membership(thread, user, :owner)
    end

    test "update_membership/2 with valid data updates the membership", %{
      thread: thread,
      user: user
    } do
      membership = membership_fixture(thread, user)
      update_attrs = %{}

      assert {:ok, %Membership{}} = Threads.update_membership(membership, update_attrs)
    end

    test "update_membership/2 with invalid data returns error changeset", %{
      thread: thread,
      user: user
    } do
      membership = membership_fixture(thread, user)
      assert {:error, %Ecto.Changeset{}} = Threads.update_membership(membership, @invalid_attrs)
      assert membership == Threads.get_membership!(membership.id)
    end

    test "delete_membership/1 deletes the membership", %{thread: thread, user: user} do
      membership = membership_fixture(thread, user)
      assert {:ok, %Membership{}} = Threads.delete_membership(membership)
      assert_raise Ecto.NoResultsError, fn -> Threads.get_membership!(membership.id) end
    end

    test "change_membership/1 returns a membership changeset", %{thread: thread, user: user} do
      membership = membership_fixture(thread, user)

      assert %Ecto.Changeset{} = Threads.change_membership(membership)
    end
  end
end
