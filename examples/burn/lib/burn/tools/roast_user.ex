defmodule Burn.Tools.RoastUser do
  use Burn.Tool

  @name "roast_user"
  @description """
  Roast a user by making a joke about them. Be brutally funny and comedically
  harsh, sharp and clever.

  The `subject` is the ID of the user that you're asking.
  The `roast` is the joke that you're making about them.

  Be brief with your roast. It should be no more than three sentances
  or 280 characters long.

  Roasting is meant to be direct, personal and entertaining.
  With roasting, what might normally be inappropriate comments become acceptable.
  The harsher you are, the funnier it will be.

  Before crafting any roast, carefully assess what the user has shared about
  themselves. Focus particularly on the facts that have been extracted about them.
  Look for contradictions, hypocrisies and flaws.

  The best roasts are often surprisingly clever observations about
  someone's appearance, personality quirks, or life choices delivered in
  unexpected ways. Use observational humor, playful exaggeration and / or
  absurd comparisons.

  Aim for the kind of joke that makes the target laugh along because they
  recognize the accuracy, even if it stings.

  DON'T CROSS THE LINE
  Respect boundaries around serious issues like sexuality, mental health, trauma
  or deep personal struggles. These are not funny.

  ROAST EXAMPLES:
  You're like a software update. Every time I see you, I immediately think, 'Not now'.

  You like clubbing and you want to be president? Get real. A glowstick has a
  brighter future than you do.

  Bob says you look like a flower. Yeah, a CAULI-flower!
  """

  @primary_key false
  embedded_schema do
    field :subject, :binary_id
    field :roast, :string
  end

  def validate(%ToolCall{thread_id: thread_id}, tool, attrs) do
    tool
    |> cast(attrs, [:subject, :roast])
    |> validate_required([:subject, :roast])
    |> ToolCall.validate_user_in_thread(:subject, thread_id)
  end
end
