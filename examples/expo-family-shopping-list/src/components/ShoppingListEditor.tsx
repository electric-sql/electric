import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { TextInput, Button } from 'react-native-paper';
import { Shopping_list } from '../generated/client';


export type ShoppingListProperties = Pick<Shopping_list, 'title'>

const ShoppingListEditor = ({
  initialTitle,
  submitText,
  onChange,
  onSubmit,
} : {
  initialTitle?: string,
  submitText: string,
  onChange?: (props : ShoppingListProperties) => void,
  onSubmit?: (props : ShoppingListProperties) => void,
}) => {
  const [ title, setTitle ] = useState(initialTitle)

  useEffect(() => {
    onChange?.({ title: title ?? '' })
  }, [title])

  const onSubmitFn = () => {
    if (!title) return
    onSubmit?.({ title })
  }

  return (
    <View style={{ gap: 16 }}>
      <TextInput
        label="Title"
        mode="outlined"
        error={title?.length === 0}
        autoFocus
        onSubmitEditing={onSubmitFn}
        placeholder="Your shopping list's title"
        value={title}
        onChangeText={setTitle}
      />
      <Button mode="contained" disabled={!title} onPress={onSubmitFn}>
        {submitText}
      </Button>
    </View>
  );
}

export default ShoppingListEditor;