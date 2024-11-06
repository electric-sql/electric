defmodule Electric.PhoenixExampleWeb.TodoLive.Index do
  use Electric.PhoenixExampleWeb, :live_view

  alias Electric.PhoenixExample.Todos
  alias Electric.PhoenixExample.Todos.Todo

  @impl true
  def mount(_params, _session, socket) do
    {:ok,
     socket
     |> assign(:electric_live, false)
     |> assign(:animate_insert, false)
     |> Electric.Phoenix.live_stream(:todos, Todos.Todo)}
  end

  @impl true
  def handle_params(_params, _url, socket) do
    {:noreply, assign(socket, :todo, %Todo{})}
  end

  @impl true
  # Progress events from the electric client.
  # - `:loaded` is sent when the initial fetch has completed
  # - `:live` is sent when the client is in `live` mode and waiting for the
  #         latest updates from the server
  def handle_info({:electric, :loaded}, socket) do
    {:noreply, socket}
  end

  # here we use the `:live` state to turn on animations for new Todos
  def handle_info({:electric, :live}, socket) do
    {:noreply, socket |> assign(:electric_live, true) |> assign(:animate_insert, true)}
  end

  # Forward all events from the Electric sync stream to the component.
  # This is **required** for the integration.
  def handle_info({:electric, event}, socket) do
    {:noreply, Electric.Phoenix.stream_update(socket, event, at: 0)}
  end

  @impl true
  def handle_event("delete", %{"id" => id}, socket) do
    {:ok, _todo} =
      id
      |> Todos.get_todo!()
      |> Todos.delete_todo()

    # Deleting is enough -- Electric will stream the update directly from the
    # database into the views
    {:noreply, socket}
  end

  def handle_event("toggle-completed", %{"id" => id}, socket) do
    {:ok, _todo} =
      id
      |> Todos.get_todo!()
      |> Todos.toggle_complete()

    # Updating is enough -- Electric will stream the update directly from the
    # database into the views
    {:noreply, socket}
  end
end
