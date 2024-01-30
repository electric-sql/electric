import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { TextInput } from 'react-native-paper';
import { Shopping_list } from '../generated/client';


export type ShoppingListProperties = Pick<Shopping_list, 'title'>

const ShoppingListEditor = ({
  initialTitle,
  onChange,
  onSubmit,
} : {
  initialTitle?: string,
  onChange: (props : ShoppingListProperties) => void,
  onSubmit?: (props: ShoppingListProperties) => void,
}) => {
  const [ title, setTitle ] = useState(initialTitle ?? '')

  useEffect(() => {
    onChange({ title })
  }, [title])

  return (
    <View>
      <TextInput
        label="Title"
        mode="outlined"
        autoFocus
        onSubmitEditing={() => onSubmit?.({ title })}
        placeholder="Your shopping list's title"
        value={title}
        onChangeText={setTitle}
      />
    </View>
  );
}

export default ShoppingListEditor;