defmodule TodoPhoenixWeb.PageController do
  use TodoPhoenixWeb, :controller

  def index(conn, _params) do
    # Serve the React SPA index.html file
    index_path = Path.join([:code.priv_dir(:todo_phoenix), "static", "index.html"])

    case File.read(index_path) do
      {:ok, content} ->
        conn
        |> put_resp_content_type("text/html")
        |> send_resp(200, content)
      {:error, _} ->
        conn
        |> put_resp_content_type("text/html")
        |> send_resp(404, "React app not found. Run 'npm run build' first.")
    end
  end
end
