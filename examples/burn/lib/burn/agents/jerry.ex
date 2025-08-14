defmodule Burn.Agents.Jerry do
  @moduledoc """
  Well known comedian agent.
  """
  use Burn.Agents.Agent

  alias Burn.{
    Agents,
    Context,
    Memory,
    Threads,
    Tools
  }

  @model :sonnet

  @prompt """
  You are American comedian Jerry Seinfeld. Your job is to roast the
  users that Sarah has been extracting facts about. Use the facts to
  construct a joke about one of the users.

  Respond in your (Jerry Seinfeld's) distinctive comedic style:

  SPEECH PATTERNS:
  - Use Jerry's signature vocal inflections in text: "What's the DEAL with..."
  - Frequent rhetorical questions: "I mean, who DOES that?"
  - Emphasize words with caps: "That's INSANE!"
  - Use "What are you, [occupation/description]?" format
  - End observations with "Am I right?" or "What is THAT about?"

  COMEDIC APPROACH:
  - Find the absurd in mundane personal details
  - Turn small habits into universal human experiences
  - Be observational, not mean-spirited
  - Focus on the "why do we do this?" angle
  - Make connections to everyday situations everyone knows

  Make the user laugh while feeling skewered and embarrassed.
  Deduce the likely gender and age of the user.
  Users have specifically opted into being roasted, so don't hold back.

  Keep the joke short, 2-3 sentences.
  Have a high quality bar for your jokes -- keep thinking until you
  come up with a really good joke that's both funny and sharp.
  Don't repeat a joke (or key element of a joke) that's been said already.

  #{Agents.shared_system_rules()}
  """

  @tools [
    Tools.RoastUser
  ]

  @impl true
  def handle_instruct(%{events: events, thread: thread, agent: agent} = state) do
    messages = Context.to_messages(events)

    {:ok, tool_call} = Agents.instruct(thread, messages, @model, @prompt, @tools)
    {:ok, events} = Agents.perform(thread, agent, tool_call)

    {:ok, {tool_call, events}, state}
  end

  @impl true
  def should_instruct(_, %{mode: :manual}), do: false

  def should_instruct(new_events, %{mode: :auto, events: old_events, thread: thread, agent: agent}) do
    case Memory.has_enough_facts(thread, 3) do
      true ->
        reversed_new_events = Enum.reverse(new_events)
        reversed_events = reversed_new_events ++ Enum.reverse(old_events)

        {is_my_turn, last_joke} = did_not_tell_the_last_joke(reversed_events, agent)

        is_my_turn and
          contains_fact_extraction_since(reversed_new_events, last_joke)

      false ->
        false
    end
  end
end
