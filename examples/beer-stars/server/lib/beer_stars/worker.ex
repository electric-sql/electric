defmodule BeerStars.Worker do
  @moduledoc """
  Walks through the Stargazers returned by the GitHub GraphQL API.
  Makes sure that they existing in the database and deletes any
  stars in the database that are no-longer on GitHub (in case we
  missed any deletes via WebHook).

  I.e.:

  - on first run, populates the database
  - on subsequent run: anti-entropy's the database

  Once run, it exits gracefully and allows new stars to be added
  and removed by webhook.
  """
  use GenServer, restart: :transient

  alias Req.Request
  alias Req.Response

  alias BeerStars.Config
  alias BeerStars.Model
  alias BeerStars.Repo

  defmodule State do
    defstruct [
      :backoff_multiplier,
      :cursor,
      :delay_ms,
      :existing_ids,
      :github_ids,
      :has_deleted_stale,
      :maximum_delay_ms,
      :minimum_delay_ms,
      :query_limit,
      :tokens,
      :tokens_length,
      token_pos: 0
    ]
  end

  @defaults [
    backoff_multiplier: 1.2,
    delay_ms: 1_000,
    limit: 100
  ]
  @endpoint "https://api.github.com/graphql"
  @template """
    query {
      repository(owner:"<%= owner %>", name:"<%= name %>") {
        stargazers(first: <%= first %><%= after_str %>) {
          edges {
            cursor,
            starredAt,
            node {
              avatarUrl,
              databaseId,
              login,
              name
            }
          }
        }
      }
    }
  """

  defp render_query(limit, cursor) do
    [repo_owner, repo_name] =
      Config.github_repo()
      |> String.split("/")

    after_str =
      case cursor do
        val when is_binary(val) ->
          ", after: \"#{cursor}\""

        nil ->
          ""
      end

    attrs = [
      after_str: after_str,
      first: limit,
      name: repo_name,
      owner: repo_owner
    ]

    EEx.eval_string(@template, attrs)
  end

  defp request(query, token) do
    Req.new(url: @endpoint)
    |> Request.put_header("Accept", "application/vnd.github+json")
    |> Request.put_header("Authorization", "Bearer #{token}")
    |> Request.put_header("X-GitHub-Api-Version", "2022-11-28")
    |> Req.post(json: %{query: query})
  end

  defp fetch(token, limit, cursor) do
    query = render_query(limit, cursor)

    case request(query, token) do
      {:ok,
       %Response{
         status: 200,
         body: %{"data" => %{"repository" => %{"stargazers" => %{"edges" => results}}}}
       }} ->
        {:ok, results}

      {:ok, %Response{status: status, body: body}} ->
        {:error, :status, status, body}

      {:error, error} ->
        {:error, :exception, error}
    end
  end

  defp insert(current_cursor, results) do
    acc = {current_cursor, []}

    {:ok, %{insert_results: {next_cursor, new_star_ids}}} =
      Ecto.Multi.new()
      |> Ecto.Multi.run(:insert_results, fn _repo, _ctx ->
        {:ok, Enum.reduce(results, acc, fn result, {_cursor, star_ids} ->
          %{
            "cursor" => cursor,
            "node" => %{
              "avatarUrl" => avatar_url,
              "databaseId" => database_id,
              "login" => username,
              "name" => name
            },
            "starredAt" => starred_at
          } = result

          {:ok, %Model.Star{id: star_id}} =
            Model.init_star(avatar_url, database_id, name, starred_at, username)
            |> Model.insert_star()

          {cursor, [star_id | star_ids]}
        end)}
      end)
      |> Repo.transaction(timeout: 600_000)

    {:ok, next_cursor, Enum.reverse(new_star_ids)}
  end

  defp trigger_fetch(delay_ms) do
    case Config.should_start_worker() do
      true ->
        Process.send_after(self(), :fetch, delay_ms)

      false ->
        Process.send_after(self(), :skip, 0)
    end
  end

  def perform_fetch(
        %State{
          backoff_multiplier: backoff_multiplier,
          cursor: cursor,
          delay_ms: delay_ms,
          existing_ids: existing_ids,
          github_ids: github_ids,
          minimum_delay_ms: minimum_delay_ms,
          maximum_delay_ms: maximum_delay_ms,
          query_limit: query_limit,
          tokens: tokens,
          tokens_length: tokens_length,
          token_pos: token_pos
        } = state
      ) do
    IO.inspect({:worker, :fetching, :after, cursor, :accumulated, Enum.count(github_ids)})

    token = Enum.at(tokens, token_pos)

    next_token_pos =
      case token_pos + 1 do
        ^tokens_length ->
          0

        val ->
          val
      end

    with {:ok, results} <- fetch(token, query_limit, cursor),
         {:ok, next_cursor, inserted_ids} <- insert(cursor, results),
         {:finished, false} <- {:finished, cursor == next_cursor} do
      new_github_ids = Enum.concat(github_ids, inserted_ids)

      %{
        state
        | cursor: next_cursor,
          delay_ms: minimum_delay_ms,
          github_ids: new_github_ids,
          token_pos: next_token_pos
      }
    else
      # We're done processing the list, so delete all
      # the existing stars that are no longer in the newly
      # accumulated GitHub IDs list. Remember that the
      # existing stars were looked up at startup, so they
      # don't include any new ones that may have come in
      # over webhook.
      {:finished, true} ->
        IO.inspect({:worker, :finished})

        {num_deleted, nil} =
          existing_ids
          |> Enum.reject(&Enum.member?(github_ids, &1))
          |> Model.delete_stars()

        {:finished, Enum.count(github_ids), num_deleted}

      # Error so backoff.
      err ->
        IO.inspect({:worker, :fetch_error, err})

        next_delay_ms =
          case floor(delay_ms * backoff_multiplier) do
            val when val > maximum_delay_ms -> maximum_delay_ms
            val -> val
          end

        IO.inspect({:worker, :backoff, :delay_md, next_delay_ms})

        %{state | delay_ms: next_delay_ms, token_pos: next_token_pos}
    end
  end

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts)
  end

  @impl true
  def init(overrides) do
    opts = Keyword.merge(@defaults, overrides)

    cursor = nil
    existing_ids = Model.existing_star_ids()
    github_ids = []
    tokens = Config.github_tokens()

    tokens_length =
      case Enum.count(tokens) do
        0 ->
          raise "Must provide at least one valid GitHub token"

        val ->
          val
      end

    state = %State{
      backoff_multiplier: opts[:backoff_multiplier],
      cursor: cursor,
      delay_ms: opts[:delay_ms],
      existing_ids: existing_ids,
      github_ids: github_ids,
      has_deleted_stale: false,
      minimum_delay_ms: opts[:delay_ms],
      maximum_delay_ms: opts[:delay_ms] * 20,
      query_limit: opts[:limit],
      tokens: tokens,
      tokens_length: tokens_length,
      token_pos: 0
    }

    trigger_fetch(0)

    {:ok, state}
  end

  @impl true
  def handle_info(:fetch, state) do
    case perform_fetch(state) do
      {:finished, num_verified, num_deleted} ->
        {:stop, :normal, {num_verified, num_deleted}}

      %State{} = next_state ->
        trigger_fetch(next_state.delay_ms)

        {:noreply, next_state}
    end
  end

  @impl true
  def handle_info(:skip, _state) do
    {:stop, :normal, :skip}
  end

  @impl true
  def terminate(:normal, :skip) do
    IO.inspect({:worker, :skipping})
  end

  @impl true
  def terminate(:normal, {num_verified, num_deleted}) do
    IO.inspect({:worker, :done, :verified, num_verified, :deleted, num_deleted})
  end

  @impl true
  def terminate(reason, state) do
    IO.inspect({:worker, :terminating, :reason, reason, :state, state})
  end
end
