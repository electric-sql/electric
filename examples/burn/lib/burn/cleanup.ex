defmodule Burn.Cleanup do
  @moduledoc """
  Cleanup old data. Partly to keep the database small. Partly to avoid
  application startup generating too many LLM calls.
  """
  require Logger

  alias Burn.{
    Accounts,
    Repo,
    Threads
  }

  def threads_older_than(n \\ 8, units \\ :hours) do
    Repo.transaction(fn ->
      with {:ok, thread_count} <- Threads.delete_threads_older_than(n, units),
           {:ok, user_count} <- Accounts.delete_human_users_with_no_threads() do
        if thread_count > 0 do
          Logger.info("Cleaned up #{thread_count} thread(s)")
        end

        if user_count > 0 do
          Logger.info("Cleaned up #{user_count} user(s)")
        end

        {thread_count, user_count}
      else
        {:error, reason} ->
          Repo.rollback(reason)

          :error
      end
    end)
  end
end
