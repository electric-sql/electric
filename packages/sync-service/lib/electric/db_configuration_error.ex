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

  def publication_missing_generated_columns(pub_name) do
    %Electric.DbConfigurationError{
      type: :publication_missing_generated_columns,
      message:
        "Publication #{Utils.quote_name(pub_name)} does not publish generated columns." <>
          " This is a feature introduced in PostgreSQL 18 and requires setting the publication parameter 'publish_generated_columns' to 'stored'." <>
          " Alternatively, you can exclude them from the shape by explicitly listing which columns to fetch in the 'columns' query param."
    }
  end

  def publication_not_owned(pub_name) do
    %Electric.DbConfigurationError{
      type: :publication_not_owned,
      message: "Publication #{Utils.quote_name(pub_name)} is not owned by the provided user"
    }
  end
end
