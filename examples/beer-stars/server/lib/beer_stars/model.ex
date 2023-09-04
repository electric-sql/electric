defmodule BeerStars.Model do
  import Ecto.Query

  alias Ecto.Multi

  alias BeerStars.Repo

  alias BeerStars.Model.Beer
  alias BeerStars.Model.Star

  defp to_binary_id(github_database_id) do
    id_str = Integer.to_string(github_database_id)

    UUID.uuid5(nil, id_str)
  end

  def existing_star_ids do
    Star
    |> select([s], s.id)
    |> Repo.all()
  end

  def init_star(avatar_url, github_database_id, name, starred_at, username) do
    attrs = %{
      avatar_url: avatar_url,
      id: to_binary_id(github_database_id),
      name: name,
      starred_at: starred_at,
      username: username
    }

    %Star{}
    |> Star.changeset(attrs)
  end

  def insert_star(changeset) do
    changeset
    |> Repo.insert(
      conflict_target: :id,
      on_conflict: {:replace, [:avatar_url, :name, :starred_at, :username]}
    )
  end

  def delete_star(github_database_id) do
    id = to_binary_id(github_database_id)

    {_, nil} =
      Beer
      |> where([b], b.star_id == ^id)
      |> Repo.update_all(set: [star_id: nil])

    Star
    |> where([s], s.id == ^id)
    |> Repo.delete_all()
  end

  def delete_stars([]) do
    {0, nil}
  end
  def delete_stars(binary_ids) do
    {_, nil} =
      Beer
      |> where([b], b.star_id in ^binary_ids)
      |> Repo.update_all(set: [star_id: nil])

    Star
    |> where([s], s.id in ^binary_ids)
    |> Repo.delete_all()
  end

  def allocate_beers do
    Multi.new()
    |> Ecto.Multi.run(:unallocated_stars, fn _repo, _ctx ->
      allocated_star_ids =
        Star
        |> join(:inner, [s], b in assoc(s, :beers))
        |> select([s], s.id)
        |> Repo.all()

      unallocated_stars =
        Star
        |> where([s], s.id not in ^allocated_star_ids)
        |> Repo.all()

      {:ok, unallocated_stars}
    end)
    |> Ecto.Multi.run(:insert_beers, fn _repo, %{unallocated_stars: unallocated_stars} ->
      inserted_beers =
        unallocated_stars
        |> Enum.map(&insert_allocated_beer/1)

      {:ok, inserted_beers}
    end)
    |> Repo.transaction(timeout: 600_000)
  end

  def insert_allocated_beer(%Star{id: star_id}) do
    %Beer{id: UUID.uuid4()}
    |> Beer.changeset(%{star_id: star_id})
    |> Repo.insert!()
  end
end
