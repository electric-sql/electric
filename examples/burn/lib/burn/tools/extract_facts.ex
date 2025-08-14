defmodule Burn.Tools.ExtractFacts do
  use Burn.Tool
  alias Ecto.Multi

  # We want the embedded module to be called `Fact` as that results
  # in clearer naming in the JSON Schema provided to the LLM.
  alias Memory.Fact, as: MemoryFact
  alias Memory.Fact.Embedded, as: Fact

  @name "extract_facts"
  @description """
  Extract `facts` about a user.

  The facts must be expressed as a `subject`, `predicate` and `object`.

  The `subject` is the user ID. You can find a user's ID in the `from` key
  of their `<user_message />`s. Be careful to get the right ID for the user
  you're extracting facts about. Do not confuse one user with another.

  The `source_event` is the ID of the message that you're extracting
  the facts from. You can find a message ID in the `id` key of the message.

  If you've previously asked a user to confirm facts that another
  user said about them, then the `source_event` should be the ID
  of the confirmation message, i.e.: the latest message where the user is
  confirming (or denying!) facts about them posted by another user.

  Note that, in a single tool call, you can extract:
  - multiple facts from the same user message
  - facts from different user messages
  - facts from different users

  Confidence must be a decimal number (with exactly one decimal place)
  between `0.1` and `1.0`. Lower means less confident, higher means
  more confident. For example `0.8` is highly confident.

  Disputed should be `false`, unless the user clearly disputes the
  fact. Note that disputed facts can often be funnier than accepted ones!
  """

  @primary_key false
  embedded_schema do
    embeds_many :facts, Fact
  end

  @impl Burn.Tool
  def validate(%ToolCall{} = tool_call, tool, attrs) do
    tool
    |> cast(attrs, [])
    |> cast_embed(:facts, with: &validate_embedded_fact(tool_call, &1, &2))
  end

  defp validate_embedded_fact(%ToolCall{thread_id: thread_id}, fact, attrs) do
    fact
    |> MemoryFact.validate_fact_fields(attrs)
    |> cast(attrs, [:source_event, :subject])
    |> validate_required([:source_event, :subject])
    |> ToolCall.validate_user_in_thread(:subject, thread_id)
    |> ToolCall.validate_event_in_thread(:source_event, thread_id)
  end

  @impl Burn.Tool
  def perform(multi, %ToolCall{thread_id: thread_id, input: %{"facts" => facts}}) do
    facts
    |> Stream.with_index()
    |> Enum.reduce(multi, &insert(thread_id, &1, &2))
  end

  defp insert(thread_id, {attrs, index}, multi) do
    with {source_event_id, attrs} <- Map.pop!(attrs, "source_event"),
         {subject_id, attrs} = Map.pop!(attrs, "subject") do
      multi
      |> Multi.insert({:fact, index}, fn %{event: %{id: tool_use_event_id}} ->
        assoc_attrs = %{
          thread_id: thread_id,
          source_event_id: source_event_id,
          tool_use_event_id: tool_use_event_id,
          subject_id: subject_id
        }

        Memory.init_fact(assoc_attrs, attrs)
      end)
    end
  end
end
