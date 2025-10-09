defmodule Electric.DbConfigurationError do
  alias Electric.Utils

  defexception [:type, :message]

  def publication_missing(pub_name) do
    %Electric.DbConfigurationError{
      type: :publication_missing,
      message: "Publication #{Utils.quote_name(pub_name)} not found in the database"
    }
  end

  def publication_missing_operations(pub_name) do
    %Electric.DbConfigurationError{
      type: :publication_missing_operations,
      message:
        "Publication #{Utils.quote_name(pub_name)} does not publish all required operations: INSERT, UPDATE, DELETE, TRUNCATE"
    }
  end

  def publication_not_owned(pub_name) do
    %Electric.DbConfigurationError{
      type: :publication_not_owned,
      message: "Publication #{Utils.quote_name(pub_name)} is not owned by the provided user"
    }
  end
end
