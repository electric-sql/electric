defmodule Burn.DataCase do
  @moduledoc """
  This module defines the setup for tests requiring
  access to the application's data layer.

  You may define functions here to be used as helpers in
  your tests.

  Finally, if the test case interacts with the database,
  we enable the SQL sandbox, so changes done to the database
  are reverted at the end of every test. If you are using
  PostgreSQL, you can even run database tests asynchronously
  by setting `use Burn.DataCase, async: true`, although
  this option is not recommended for other databases.
  """

  use ExUnit.CaseTemplate

  using do
    quote do
      alias Burn.Repo

      import Ecto
      import Ecto.Changeset
      import Ecto.Query
      import Burn.DataCase
    end
  end

  setup tags do
    Burn.DataCase.setup_sandbox(tags)
    :ok
  end

  @doc """
  Sets up the sandbox based on the test tags.
  """
  def setup_sandbox(tags) do
    pid = Ecto.Adapters.SQL.Sandbox.start_owner!(Burn.Repo, shared: not tags[:async])
    Phoenix.Sync.Sandbox.start!(Burn.Repo, pid, shared: not tags[:async])

    on_exit(fn ->
      Ecto.Adapters.SQL.Sandbox.stop_owner(pid)
    end)
  end

  @doc """
  Helper for asserting that a function will return
  a truthy value eventually within a given time frame.
  From https://peterullrich.com/async-testing-with-eventually
  """
  def assert_eventually(fun, timeout \\ 2_000, interval \\ 20)

  def assert_eventually(_fun, timeout, _interval) when timeout <= 0 do
    raise ExUnit.AssertionError, "Failed to receive a truthy result before timeout."
  end

  def assert_eventually(fun, timeout, interval) do
    result = fun.()

    ExUnit.Assertions.assert(result)

    result
  rescue
    ExUnit.AssertionError ->
      Process.sleep(interval)

      assert_eventually(fun, timeout - interval, interval)
  end

  @doc """
  A helper that transforms changeset errors into a map of messages.

      assert {:error, changeset} = Accounts.create_user(%{password: "short"})
      assert "password is too short" in errors_on(changeset).password
      assert %{password: ["password is too short"]} = errors_on(changeset)

  """
  def errors_on(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {message, opts} ->
      Regex.replace(~r"%{(\w+)}", message, fn _, key ->
        opts |> Keyword.get(String.to_existing_atom(key), key) |> to_string()
      end)
    end)
  end
end
