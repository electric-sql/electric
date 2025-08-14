defmodule Burn.Tools.AskUserAboutThemselves do
  use Burn.Tool

  @name "ask_user_about_themselves"
  @description """
  Ask a user for information about themselves.

  The `subject` is the ID of the user that you're asking.
  The `question` is the question that you're asking them.

  Be brief yet creative with your question. It should:
  - be no more than two sentances long
  - elicit information that you can (later) convert into facts

  When using this `ask_user_about_themselves` tool, you must only ask
  the user for information about themselves, not about other users.
  """

  @primary_key false
  embedded_schema do
    field :subject, :binary_id
    field :question, :string
  end

  def validate(%ToolCall{thread_id: thread_id}, tool, attrs) do
    tool
    |> cast(attrs, [:subject, :question])
    |> validate_required([:subject, :question])
    |> ToolCall.validate_user_in_thread(:subject, thread_id)
  end
end
