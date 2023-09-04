Mix.install([
  :cors_plug,
  :jason,
  :plug,
  :plug_cowboy,
  :postgrex
])

defmodule Server do
  use Plug.Router

  @uuid ~r/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  @timestamp ~r/^[0-9]{13,20}$/

  plug(Plug.Logger)
  plug(CORSPlug)

  plug(Plug.Parsers,
    parsers: [:json],
    pass: ["application/json"],
    json_decoder: Jason
  )

  plug(:match)
  plug(:dispatch)

  get "/items" do
    with %{"demo_id" => demo_id} <- conn.params,
         true <- String.match?(demo_id, @uuid),
         %Postgrex.Result{command: :select, columns: columns, rows: rows} <-
           Postgrex.query!(
             :db,
             """
                SELECT id, demo_id, inserted_at
                  FROM items
                  WHERE demo_id = $1
                  ORDER BY inserted_at ASC
                  LIMIT 24
             """,
             [demo_id]
           ) do
      results =
        Enum.map(rows, fn row ->
          Enum.zip(columns, row)
          |> Enum.into(%{})
          |> Map.update!("inserted_at", fn inserted_at_dt ->
            inserted_at_dt
            |> DateTime.from_naive!("Etc/UTC")
            |> DateTime.to_unix(:millisecond)
            |> Integer.to_string()
          end)
        end)

      conn
      |> put_resp_content_type("application/json")
      |> send_resp(200, Jason.encode!(results))
    end
  end

  post "/items" do
    with %{"data" => %{"demo_id" => demo_id, "id" => item_id, "inserted_at" => inserted_at_str}} <-
           conn.params,
         true <- String.match?(item_id, @uuid),
         true <- String.match?(demo_id, @uuid),
         true <- String.match?(inserted_at_str, @timestamp),
         {:ok, %DateTime{} = inserted_at_dt} <-
           inserted_at_str
           |> String.to_integer()
           |> DateTime.from_unix(:millisecond),
         %Postgrex.Result{command: :insert, num_rows: 1} <-
           Postgrex.query!(:db, "INSERT INTO items VALUES ($1, $2, $3)", [
             item_id,
             demo_id,
             inserted_at_dt
           ]) do
      conn
      |> put_resp_content_type("application/json")
      |> send_resp(200, "{}")
    end
  end

  post "/items/bootstrap" do
    with %{"data" => %{"session_id" => session_id, "demo_id" => demo_id, "name" => name, "num_items" => num_items}} <-
           conn.params,
         true <- String.match?(session_id, @uuid),
         true <- String.match?(demo_id, @uuid),
         true <- is_integer(num_items) and num_items < 12,
         {:ok, _res} <- Postgrex.transaction(:db, fn(conn) ->
            # Insert the session.
            Postgrex.query!(
              conn,
              "INSERT INTO sessions (id, inserted_at) VALUES ($1, $2)",
              [session_id, DateTime.utc_now()]
            )
            # Insert the demo.
            Postgrex.query!(
              conn,
              "INSERT INTO demos (id, session_id, name) VALUES ($1, $2, $3)",
              [demo_id, session_id, name]
            )
            # Insert the items.
            t1 = DateTime.utc_now() |> DateTime.to_unix()
            Enum.each(1..num_items, fn n ->
              {:ok, inserted_at} = DateTime.from_unix(t1 + n, :millisecond)
              Postgrex.query!(
                conn,
                "INSERT INTO items (id, demo_id, inserted_at) VALUES (gen_random_uuid(), $1, $2)",
                [demo_id, inserted_at]
              )
            end)
         end) do
      conn
      |> put_resp_content_type("application/json")
      |> send_resp(200, "{}")
    end
  end

  delete "/items" do
    with %{"data" => %{"demo_id" => demo_id}} <- conn.params,
         true <- String.match?(demo_id, @uuid),
         %Postgrex.Result{command: :delete} <-
           Postgrex.query!(:db, "DELETE FROM items WHERE demo_id = $1", [demo_id]) do
      conn
      |> send_resp(204, "")
    end
  end

  match _ do
    conn
    |> put_resp_content_type("application/json")
    |> send_resp(404, "{\"error\": \"Not found\"}")
  end
end

db_opts = [
  database: System.get_env("DB_NAME", "intro"),
  hostname: System.get_env("DB_HOST", "localhost"),
  password: System.get_env("DB_PASS", "password"),
  port: System.get_env("DB_PORT", "5432") |> String.to_integer(),
  ssl: System.get_env("DB_SSL") == "true",
  username: System.get_env("DB_USER", "electric")
]

{:ok, _} = Plug.Cowboy.http(Server, [], port: 5000)
{:ok, pid} = Postgrex.start_link(db_opts)

Process.register(pid, :db)

IO.puts("Server running on localhost:5000")
