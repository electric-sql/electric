defmodule BeerStars.Config do
  defp config(key) do
    :beer_stars
    |> Application.fetch_env!(key)
  end

  def github_repo do
    :github_repo
    |> config()
    |> String.trim()
  end

  def github_tokens do
    :github_tokens
    |> config()
    |> String.trim()
    |> String.split()
  end

  def get_auth_token do
    github_tokens()
    |> Enum.random()
  end

  def should_start_worker do
    config(:worker)
  end
end
