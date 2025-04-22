defmodule Electric.FatalError do
  defexception [:message, :type, :original_error]
end
