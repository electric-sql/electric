defmodule Burn.Shapes do
  @moduledoc """
  Shape definition factory functions.
  """
  import Ecto.Query, only: [from: 2]

  alias Burn.Threads

  @doc """
  Sync all of the events in a thread.
  """
  def events(%Threads.Thread{id: thread_id}) do
    from(e in Threads.Event, where: e.thread_id == ^thread_id)
  end

  @doc """
  Sync all of the membership records for a thread.
  """
  def memberships(%Threads.Thread{id: thread_id}) do
    from(m in Threads.Membership, where: m.thread_id == ^thread_id)
  end

  @doc """
  Sync all of the changes to a thread.
  """
  def thread(%Threads.Thread{id: id}) do
    from(t in Threads.Thread, where: t.id == ^id)
  end
end
