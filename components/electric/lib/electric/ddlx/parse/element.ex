defmodule Electric.DDLX.Parse.Element do
  alias __MODULE__

  @type element_value_type :: :name | :collection | :path | :string

  @type t() :: %Element{
          required: boolean,
          options: [String.t()],
          type: String.t(),
          valueType: element_value_type,
          name: String.t()
        }
  @enforce_keys [
    :required,
    :options,
    :type,
    :name
  ]
  defstruct [
    :required,
    :options,
    :type,
    :name,
    :valueType
  ]

  def read(element, tokens) do
    if length(tokens) == 0 do
      {:ok, tokens, nil, nil, nil}
    else
      case element.type do
        "keyword" -> read_keyword(element, tokens)
        "value" -> read_value(element, tokens)
        "kv" -> read_kv(element, tokens)
      end
    end
  end

  def read_keyword(element, tokens) do
    with {[{:keyword, value}], shorter_tokens} <- Enum.split(tokens, 1),
         true <- Enum.member?(element.options, value) do
      if element.name != nil do
        {:ok, shorter_tokens, element.name, value, nil}
      else
        {:ok, shorter_tokens, nil, nil, nil}
      end
    else
      _err ->
        #        IO.inspect(err)
        if element.required do
          {_, value} = Enum.at(tokens, 0)
          {:error, "Something went wrong near #{value}"}
        else
          {:ok, tokens, nil, nil, nil}
        end
    end
  end

  def check_token_value_type(_tokenValueType, elementValueType) when is_nil(elementValueType) do
    true
  end

  def check_token_value_type(tokenValueType, elementValueType) when is_atom(elementValueType) do
    tokenValueType == elementValueType
  end

  def check_token_value_type(tokenValueType, elementValueType) when is_list(elementValueType) do
    tokenValueType in elementValueType
  end

  def read_value(element, tokens) do
    with {[{tokenValueType, value}], shorter_tokens} <- Enum.split(tokens, 1),
         true <- tokenValueType != nil and tokenValueType != :keyword do
      if element.name != nil do
        if check_token_value_type(tokenValueType, element.valueType) do
          {:ok, shorter_tokens, element.name, value, tokenValueType}
        else
          {:error, "Something went wrong near #{value}"}
        end
      else
        {:ok, shorter_tokens, nil, nil, nil}
      end
    else
      _err ->
        if element.required do
          {_, value} = Enum.at(tokens, 0)
          {:error, "Something went wrong near #{value}"}
        else
          {:ok, tokens, nil, nil, nil}
        end
    end
  end

  def read_kv(element, tokens) do
    with {[{:keyword, k}], shorter_tokens} <- Enum.split(tokens, 1),
         true <- Enum.member?(element.options, k),
         {[{tokenValueType, value}], even_shorter_tokens} <- Enum.split(shorter_tokens, 1),
         true <- tokenValueType != nil and tokenValueType != :keyword do
      if element.name != nil do
        if check_token_value_type(tokenValueType, element.valueType) do
          {:ok, even_shorter_tokens, element.name, value, tokenValueType}
        else
          {:error, "Something went wrong near #{value}"}
        end
      else
        {:ok, even_shorter_tokens, nil, nil, nil}
      end
    else
      _err ->
        if element.required do
          {_, value} = Enum.at(tokens, 0)
          {:error, "Something went wrong near #{value}"}
        else
          {:ok, tokens, nil, nil, nil}
        end
    end
  end
end
