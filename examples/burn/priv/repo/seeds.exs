# Script for populating the database. You can run it as:
#
#     mix run priv/repo/seeds.exs
#
# Inside the script, you can read and write to any of your
# repositories directly:
#
#     Burn.Repo.insert!(%Burn.SomeSchema{})
#
# We recommend using the bang functions (`insert!`, `update!`
# and so on) as they will fail if something goes wrong.

alias Burn.{Accounts, Repo}

# Seed the system agents

producers = [
  "sarah"
]

comedians = [
  "jerry",
  "frankie"
]

Enum.each(producers ++ comedians, fn name ->
  display_name = String.capitalize(name)

  case Accounts.get_agent_by_name(name) do
    nil ->
      attrs = %{
        type: :agent,
        name: name,
        avatar_url: "/images/agents/#{name}.jpg"
      }

      %Accounts.User{}
      |> Accounts.User.changeset(attrs)
      |> Repo.insert!()
      |> IO.inspect(label: "Created #{display_name} agent")

    agent ->
      IO.inspect(agent, label: "#{display_name} agent already exists")
  end
end)
