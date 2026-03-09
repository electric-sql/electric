defprotocol Electric.Shapes.Consumer.Subqueries.StateMachine do
  @spec handle_event(t(), term()) :: {list(term()), t()}
  def handle_event(state, event)
end
