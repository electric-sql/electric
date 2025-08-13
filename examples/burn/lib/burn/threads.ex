defmodule Burn.Threads do
  @moduledoc """
  The Threads context.
  """

  import Ecto.Query, warn: false
  alias Ecto.Changeset

  alias Burn.Accounts
  alias Burn.Repo

  alias Burn.Threads.{
    Event,
    Membership,
    Thread
  }

  @doc """
  Returns the list of threads.

  ## Examples

      iex> list_threads()
      [%Thread{}, ...]

  """
  def list_threads do
    Repo.all(Thread)
  end

  @doc """
  Gets a single thread.

  Raises `Ecto.NoResultsError` if the Thread does not exist.

  ## Examples

      iex> get_thread!(123)
      %Thread{}

      iex> get_thread!(456)
      ** (Ecto.NoResultsError)

  """
  def get_thread!(id), do: Repo.get!(Thread, id)

  @doc """
  Gets a single thread.

  Returns `nil` if the Thread does not exist.

  ## Examples

      iex> get_thread(123)
      %Thread{}

      iex> get_thread(456)
      nil

  """
  def get_thread(id), do: Repo.get(Thread, id)

  def init_thread(attrs \\ %{}) do
    %Thread{}
    |> Thread.changeset(attrs)
  end

  @doc """
  Creates a thread.

  ## Examples

      iex> create_thread(%{field: value})
      {:ok, %Thread{}}

      iex> create_thread(%{field: bad_value})
      {:error, %Changeset{}}

  """
  def create_thread(attrs \\ %{}) do
    init_thread(attrs)
    |> Repo.insert()
  end

  def create_new_thread(%Accounts.User{id: user_id}) do
    num_existing_threads =
      Repo.one(
        from(
          m in Membership,
          where: m.user_id == ^user_id,
          select: count(m.thread_id)
        )
      )

    name =
      case num_existing_threads do
        0 ->
          "Untitled thread"

        n ->
          "Untitled thread #{n + 1}"
      end

    create_thread(%{name: name, status: :started, user_id: user_id})
  end

  @doc """
  Updates a thread.

  ## Examples

      iex> update_thread(thread, %{field: new_value})
      {:ok, %Thread{}}

      iex> update_thread(thread, %{field: bad_value})
      {:error, %Changeset{}}

  """
  def update_thread(%Thread{} = thread, attrs) do
    thread
    |> Thread.changeset(attrs)
    |> Repo.update()
  end

  @doc """
  Deletes a thread.

  ## Examples

      iex> delete_thread(thread)
      {:ok, %Thread{}}

      iex> delete_thread(thread)
      {:error, %Changeset{}}

  """
  def delete_thread(%Thread{} = thread) do
    Repo.delete(thread)
  end

  @doc """
  Returns an `%Changeset{}` for tracking thread changes.

  ## Examples

      iex> change_thread(thread)
      %Changeset{data: %Thread{}}

  """
  def change_thread(%Thread{} = thread, attrs \\ %{}) do
    Thread.changeset(thread, attrs)
  end

  @doc """
  Returns the list of events.

  ## Examples

      iex> list_events()
      [%Event{}, ...]

  """
  def list_events do
    Repo.all(Event)
  end

  @doc """
  Gets a single event.

  Raises `Ecto.NoResultsError` if the Event does not exist.

  ## Examples

      iex> get_event!(123)
      %Event{}

      iex> get_event!(456)
      ** (Ecto.NoResultsError)

  """
  def get_event!(id), do: Repo.get!(Event, id)

  def event_in_thread?(thread_id, event_id) do
    query =
      from(
        e in Event,
        where:
          e.thread_id == ^thread_id and
            e.id == ^event_id
      )

    Repo.exists?(query)
  end

  @doc """
  Creates a event.

  ## Examples

      iex> create_event(thread, user, %{field: value})
      {:ok, %Event{}}

      iex> create_event(thread, user, %{field: bad_value})
      {:error, %Changeset{}}

  """
  def create_event(%Thread{} = thread, %Accounts.User{} = user, attrs \\ %{}) do
    thread
    |> init_event(user, attrs)
    |> insert_event()
  end

  def init_event(
        %Thread{id: thread_id},
        %Accounts.User{id: user_id, type: user_type},
        attrs \\ %{}
      ) do
    init_event(thread_id, user_id, user_type, attrs)
  end

  def init_event(thread_id, user_id, user_type, %{} = attrs)
      when is_binary(thread_id) and is_binary(user_id) and user_type in [:human, :agent] do
    %Event{}
    |> Changeset.cast(%{thread_id: thread_id, user_id: user_id}, [:thread_id, :user_id])
    |> Event.changeset(attrs, user_type)
  end

  def init_user_thread_event(thread_id, user_id, user_type, action)
      when is_binary(thread_id) and
             is_binary(user_id) and
             user_type in [:human, :agent] and
             is_atom(action) do
    attrs = %{
      type: :system,
      data: %{
        action: action,
        target: :thread
      }
    }

    init_event(thread_id, user_id, user_type, attrs)
  end

  def create_user_created_thread_event(
        %Thread{id: thread_id},
        %Accounts.User{id: user_id, type: user_type}
      ) do
    init_user_thread_event(thread_id, user_id, user_type, :created)
    |> insert_event()
  end

  def insert_event(%Changeset{} = changeset) do
    changeset
    |> Repo.insert()
  end

  def insert_event(%Event{} = event) do
    event
    |> change_event()
    |> Repo.insert()
  end

  @doc """
  Updates a event.

  ## Examples

      iex> update_event(event, %{field: new_value})
      {:ok, %Event{}}

      iex> update_event(event, %{field: bad_value})
      {:error, %Changeset{}}

  """
  def update_event(%Event{} = event, attrs) do
    event
    |> Event.changeset(attrs)
    |> Repo.update()
  end

  @doc """
  Deletes a event.

  ## Examples

      iex> delete_event(event)
      {:ok, %Event{}}

      iex> delete_event(event)
      {:error, %Changeset{}}

  """
  def delete_event(%Event{} = event) do
    Repo.delete(event)
  end

  @doc """
  Returns an `%Changeset{}` for tracking event changes.

  ## Examples

      iex> change_event(event)
      %Changeset{data: %Event{}}

  """
  def change_event(%Event{} = event, attrs \\ %{}) do
    Event.changeset(event, attrs)
  end

  @doc """
  Returns the list of memberships.

  ## Examples

      iex> list_memberships()
      [%Membership{}, ...]

  """
  def list_memberships do
    Repo.all(Membership)
  end

  @doc """
  Gets a single membership.

  Raises `Ecto.NoResultsError` if the Membership does not exist.

  ## Examples

      iex> get_membership!(123)
      %Membership{}

      iex> get_membership!(456)
      ** (Ecto.NoResultsError)

  """
  def get_membership!(id), do: Repo.get!(Membership, id)

  @doc """
  Gets a single membership.

  Returns `nil` if the Membership does not exist.

  ## Examples

      iex> get_membership(123)
      %Membership{}

      iex> get_membership(456)
      nil

  """
  def get_membership(id), do: Repo.get(Membership, id)

  @doc """
  Get a membership for a specific thread and agent name.
  Returns the membership preloaded with thread and user, or nil if not found.
  """
  def get_membership_for(thread_id, agent_name)
      when is_binary(thread_id) and is_binary(agent_name) do
    query =
      from(m in Membership,
        join: u in assoc(m, :user),
        join: t in assoc(m, :thread),
        where: m.thread_id == ^thread_id and u.name == ^agent_name and u.type == :agent,
        preload: [user: u, thread: t]
      )

    Repo.one(query)
  end

  def is_member?(thread_id, user_id) do
    query =
      from(
        m in Membership,
        where:
          m.thread_id == ^thread_id and
            m.user_id == ^user_id
      )

    Repo.exists?(query)
  end

  def is_owner?(thread_id, user_id) do
    query =
      from(
        m in Membership,
        where:
          m.thread_id == ^thread_id and
            m.user_id == ^user_id and
            m.role == :owner
      )

    Repo.exists?(query)
  end

  def init_membership(attrs \\ %{}) do
    %Membership{}
    |> Membership.changeset(attrs)
  end

  @doc """
  Creates a membership.

  ## Examples

      iex> create_membership(thread, user, role)
      {:ok, %Membership{role: ^role}}

      iex> create_membership(thread, user, role)
      {:error, %Changeset{}}

  """
  def create_membership(%Thread{id: thread_id}, %Accounts.User{id: user_id}, role)
      when is_atom(role) do
    attrs = %{
      thread_id: thread_id,
      user_id: user_id,
      role: role
    }

    attrs
    |> init_membership()
    |> Repo.insert()
  end

  @doc """
  Updates a membership.

  ## Examples

      iex> update_membership(membership, %{field: new_value})
      {:ok, %Membership{}}

      iex> update_membership(membership, %{field: bad_value})
      {:error, %Changeset{}}

  """
  def update_membership(%Membership{} = membership, attrs) do
    membership
    |> Membership.changeset(attrs)
    |> Repo.update()
  end

  @doc """
  Deletes a membership.

  ## Examples

      iex> delete_membership(membership)
      {:ok, %Membership{}}

      iex> delete_membership(membership)
      {:error, %Changeset{}}

  """
  def delete_membership(%Membership{} = membership) do
    Repo.delete(membership)
  end

  @doc """
  Returns an `%Changeset{}` for tracking membership changes.

  ## Examples

      iex> change_membership(membership)
      %Changeset{data: %Membership{}}

  """
  def change_membership(%Membership{} = membership, attrs \\ %{}) do
    Membership.changeset(membership, attrs)
  end
end
