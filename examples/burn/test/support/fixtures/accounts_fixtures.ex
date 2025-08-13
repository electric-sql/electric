defmodule Burn.AccountsFixtures do
  @moduledoc """
  This module defines test helpers for creating
  entities via the `Burn.Accounts` context.
  """

  def random_suffix, do: :crypto.strong_rand_bytes(7) |> Base.encode16(case: :lower)
  def unique_human_name, do: "u#{random_suffix()}"
  def unique_agent_name, do: "a#{random_suffix()}"

  def valid_user_attributes(attrs \\ %{}) do
    Enum.into(attrs, %{
      name: unique_human_name(),
      type: :human
    })
  end

  def user_fixture(attrs \\ %{}) do
    {:ok, user} =
      attrs
      |> valid_user_attributes()
      |> Burn.Accounts.create_user()

    user
  end

  def agent_fixture(attrs \\ %{}) do
    attrs = Enum.into(attrs, %{type: :agent, name: unique_agent_name()})

    user_fixture(attrs)
  end
end
