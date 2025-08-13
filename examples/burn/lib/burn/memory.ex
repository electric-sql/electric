defmodule Burn.Memory do
  @moduledoc """
  The Memory context.
  """

  alias Ecto.Changeset
  import Ecto.Query, warn: false

  alias Burn.{
    Accounts,
    Repo,
    Threads
  }

  alias Burn.Memory.Fact

  @doc """
  Returns the list of facts.

  ## Examples

      iex> list_facts()
      [%Fact{}, ...]

  """
  def list_facts do
    Repo.all(Fact)
  end

  @doc """
  Gets a single fact.

  Raises `Ecto.NoResultsError` if the Fact does not exist.

  ## Examples

      iex> get_fact!(123)
      %Fact{}

      iex> get_fact!(456)
      ** (Ecto.NoResultsError)

  """
  def get_fact!(id), do: Repo.get!(Fact, id)

  @doc """
  Checks if the thread contains enough facts about any single subject.

  Returns `true` if there exists at least one subject in the thread that has
  a number of facts equal to or greater than the specified threshold. Uses
  efficient querying by grouping facts by subject and stopping at the first
  subject that meets the criteria.

  ## Parameters

    * `thread` - A `%Threads.Thread{}` struct to check for facts
    * `threshold` - The minimum number of facts required per subject (defaults to 3)

  ## Examples

      iex> thread = %Threads.Thread{id: 1}
      iex> has_enough_facts(thread)
      true

      iex> has_enough_facts(thread, 5)
      false

  ## Returns

    * `true` if any subject in the thread has at least `threshold` facts
    * `false` if no subject meets the threshold requirement
  """
  def has_enough_facts(%Threads.Thread{id: thread_id}, threshold \\ 3) do
    query =
      from(f in Fact,
        where: f.thread_id == ^thread_id,
        group_by: f.subject_id,
        having: count(f.id) >= ^threshold,
        limit: 1
      )

    Repo.exists?(query)
  end

  def has_enough_facts_for(%Threads.Thread{id: thread_id}, subject_id, threshold \\ 3) do
    count =
      from(f in Fact,
        where: f.thread_id == ^thread_id,
        where: f.subject_id == ^subject_id
      )
      |> Repo.aggregate(:count, :id)

    count >= threshold
  end

  @doc """
  Creates a fact.

  ## Examples

      iex> create_fact(%{field: value})
      {:ok, %Fact{}}

      iex> create_fact(%{field: bad_value})
      {:error, %Changeset{}}

  """
  def create_fact(
        %Threads.Thread{id: thread_id},
        %Threads.Event{id: source_event_id},
        %Threads.Event{id: tool_use_event_id},
        %Accounts.User{id: subject_id},
        attrs \\ %{}
      ) do
    assoc_attrs = %{
      thread_id: thread_id,
      source_event_id: source_event_id,
      tool_use_event_id: tool_use_event_id,
      subject_id: subject_id
    }

    assoc_attrs
    |> init_fact(attrs)
    |> Repo.insert()
  end

  def init_fact(assoc_attrs, attrs) do
    %Fact{}
    |> Changeset.cast(assoc_attrs, Map.keys(assoc_attrs))
    |> Fact.changeset(attrs)
  end

  @doc """
  Updates a fact.

  ## Examples

      iex> update_fact(fact, %{field: new_value})
      {:ok, %Fact{}}

      iex> update_fact(fact, %{field: bad_value})
      {:error, %Changeset{}}

  """
  def update_fact(%Fact{} = fact, attrs) do
    fact
    |> Fact.changeset(attrs)
    |> Repo.update()
  end

  @doc """
  Deletes a fact.

  ## Examples

      iex> delete_fact(fact)
      {:ok, %Fact{}}

      iex> delete_fact(fact)
      {:error, %Changeset{}}

  """
  def delete_fact(%Fact{} = fact) do
    Repo.delete(fact)
  end

  @doc """
  Returns an `%Changeset{}` for tracking fact changes.

  ## Examples

      iex> change_fact(fact)
      %Changeset{data: %Fact{}}

  """
  def change_fact(%Fact{} = fact, attrs \\ %{}) do
    Fact.changeset(fact, attrs)
  end
end
