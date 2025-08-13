defmodule Burn.Accounts.User do
  use Ecto.Schema
  import Ecto.Changeset

  alias Burn.Threads

  @derive {Jason.Encoder, only: [:id, :name]}
  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id
  schema "users" do
    field :type, Ecto.Enum, values: [:human, :agent]

    field :name, :string
    field :avatar_url, :string

    many_to_many :threads, Threads.Thread, join_through: Threads.Membership

    timestamps(type: :utc_datetime)
  end

  def changeset(user, attrs) do
    user
    |> cast(attrs, [:name, :type, :avatar_url])
    |> validate_required([:name, :type])
    |> update_change(:name, &String.downcase/1)
    |> validate_length(:name, min: 2, max: 16)
    |> validate_format(:name, ~r/^[\w-]+$/)
    |> validate_name_uniqueness()
    |> validate_image_url(:avatar_url)
  end

  defp validate_name_uniqueness(changeset) do
    changeset
    |> get_field(:type)
    |> validate_name_uniqueness(changeset)
  end

  defp validate_name_uniqueness(:human, changeset) do
    changeset
    |> unique_constraint(:name, name: :users_human_name_unique_idx)
  end

  defp validate_name_uniqueness(:agent, changeset) do
    changeset
  end

  defp validate_image_url(changeset, field) do
    validate_change(changeset, field, fn field, value ->
      with true <- is_https_url_or_path(value),
           true <- is_valid_image(value) do
        []
      else
        {:error, message} -> [{field, message}]
      end
    end)
  end

  defp is_https_url_or_path(url) do
    uri = URI.parse(url)

    is_valid =
      case {uri.scheme, uri.host, uri.path} do
        {"https", host, _path} when not is_nil(host) ->
          true

        {nil, nil, path} ->
          String.starts_with?(path, "/")

        _alt ->
          false
      end

    if is_valid do
      true
    else
      {:error, "must be a path starting with `/` or an HTTPS URL"}
    end
  end

  defp is_valid_image("https://" <> _rest = url) do
    with {:ok, %Req.Response{status: 200} = response} <- Req.get(url, receive_timeout: 5_000),
         ["image/" <> _rest] <- Req.Response.get_header(response, "content-type") do
      true
    else
      {:ok, %Req.Response{status: status}} ->
        {:error, "URL returned status #{status}, expected 200"}

      {:error, exception} ->
        {:error, "URL request failed: #{Exception.message(exception)}"}

      headers ->
        {:error, "Invalid content type: #{inspect(headers)}"}
    end
  end

  defp is_valid_image(_path), do: true
end
