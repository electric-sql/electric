defmodule Electric.Postgres.TestConnection do
  def config do
    [
      host: System.get_env("PG_HOST", "localhost"),
      port: System.get_env("PG_PORT", "54321"),
      database: System.get_env("PG_DB", "electric"),
      username: System.get_env("PG_USERNAME", "electric"),
      password: System.get_env("PGPASSWORD", "password")
    ]
    |> Keyword.update!(:port, &String.to_integer/1)
    |> Enum.reject(fn {_, v} -> is_nil(v) end)
    |> Enum.map(fn
      {k, v} when is_integer(v) -> {k, v}
      {k, v} -> {k, to_charlist(v)}
    end)
  end

  def childspec(config) do
    %{
      id: :epgsql,
      start: {:epgsql, :connect, [config]}
    }
  end
end
