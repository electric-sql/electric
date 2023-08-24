defmodule BeerStarsWeb.WebhookController do
  use BeerStarsWeb, :controller

  alias Req.Request
  alias Req.Response

  alias BeerStars.Config
  alias BeerStars.Model

  def create(conn, %{"repository" => %{"full_name" => github_repo}} = params) do
    case github_repo == target_repo() do
      true ->
        conn
        |> handle(params)

      false ->
        conn
        |> put_status(400)
        |> json(%{error: "Wrong repo"})
    end
  end

  defp handle(conn, %{
         "action" => "created",
         "starred_at" => starred_at,
         "sender" => %{
           "id" => database_id,
           "login" => username,
           "avatar_url" => avatar_url,
           "url" => api_url
         }
       }) do
    name =
      case get_user_name(api_url) do
        {:ok, val} ->
          val

        {:error, _} ->
          ""
      end

    case Model.init_star(avatar_url, database_id, name, starred_at, username)
         |> Model.insert_star() do
      {:ok, _} ->
        IO.inspect({:webhook, :star, :created_by, username})

        conn
        |> json(%{})

      {:error, error} ->
        IO.inspect({:webhook, :star, :created_by, username, :insert, :failed, error})

        conn
        |> json(%{})
    end
  end

  defp handle(conn, %{
         "action" => "deleted",
         "sender" => %{"id" => database_id, "login" => username}
       }) do
    case Model.delete_star(database_id) do
      {1, nil} ->
        IO.inspect({:webhook, :star, :deleted_by, username})

        conn
        |> json(%{})

      {0, nil} ->
        IO.inspect({:webhook, :star, :deleted_by, username, :not_found})

        conn
        |> json(%{})
    end
  end

  defp get_user_name(api_url) do
    token = Config.get_auth_token()

    case request(api_url, token) do
      %Response{status: 200, body: %{"name" => name}} ->
        {:ok, name}

      alt ->
        {:error, alt}
    end
  end

  defp request(url, token) do
    Req.new(url: url)
    |> Request.put_header("Accept", "application/json")
    |> Request.put_header("Authorization", "Bearer #{token}")
    |> Request.put_header("X-GitHub-Api-Version", "2022-11-28")
    |> Req.get()
  end

  defp target_repo do
    Application.fetch_env!(:beer_stars, :github_repo)
  end
end
