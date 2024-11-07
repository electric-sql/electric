defmodule Electric.PhoenixExampleWeb.TodoLive.FormComponent do
  use Electric.PhoenixExampleWeb, :live_component

  alias Electric.PhoenixExample.Todos
  alias Electric.PhoenixExample.Todos.Todo

  @impl true
  def render(assigns) do
    ~H"""
    <div class="px-3">
      <.form for={@form} id="todo-form" phx-target={@myself} phx-change="validate" phx-submit="save">
        <div class="mt-7">
          <div class="flex items-center justify-between space-x-4">
            <.input
              field={@form[:text]}
              type="text"
              class="inline-flex grow placeholder-slate-300"
              placeholder="Thing to do..."
            />
            <.button phx-disable-with="Saving..." class="flex-none bg-violet-500 text-white">
              Add Todo
            </.button>
          </div>
        </div>
      </.form>
    </div>
    """
  end

  @impl true
  def update(%{todo: todo} = assigns, socket) do
    {:ok,
     socket
     |> assign(assigns)
     |> assign_new(:form, fn ->
       to_form(Todos.change_todo(todo))
     end)}
  end

  @impl true
  def handle_event("validate", %{"todo" => todo_params}, socket) do
    changeset = Todos.change_todo(socket.assigns.todo, todo_params)
    {:noreply, assign(socket, form: to_form(changeset, action: :validate))}
  end

  def handle_event("save", %{"todo" => todo_params}, socket) do
    save_todo(socket, socket.assigns.action, todo_params)
  end

  defp save_todo(socket, :edit, todo_params) do
    case Todos.update_todo(socket.assigns.todo, todo_params) do
      {:ok, _todo} ->
        {:noreply,
         socket
         |> put_flash(:info, "Todo updated successfully")
         |> push_patch(to: socket.assigns.patch)}

      {:error, %Ecto.Changeset{} = changeset} ->
        {:noreply, assign(socket, form: to_form(changeset))}
    end
  end

  defp save_todo(socket, :new, todo_params) do
    case Todos.create_todo(todo_params) do
      {:ok, _todo} ->
        new_todo = %Todo{}

        {:noreply,
         socket
         |> put_flash(:info, "Todo created successfully")
         |> assign(:todo, new_todo)
         |> assign(:form, to_form(Todos.change_todo(new_todo)))}

      {:error, %Ecto.Changeset{} = changeset} ->
        {:noreply, assign(socket, form: to_form(changeset))}
    end
  end
end
