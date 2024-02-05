import React, { useEffect, useState } from 'react'
import { View } from 'react-native'
import { TextInput, Button } from 'react-native-paper'
import { Shopping_list } from '../generated/client'
import FamilyDropDown from './FamilyDropDown'

export type ShoppingListProperties = Pick<Shopping_list, 'title' | 'family_id'>

const ShoppingListEditor = ({
  initialTitle,
  initialFamilyId,
  showFamilyPicker = true,
  submitText,
  onChange,
  onSubmit,
} : {
  initialTitle?: string,
  initialFamilyId: string,
  showFamilyPicker?: boolean,
  submitText: string,
  onChange?: (props : ShoppingListProperties) => void,
  onSubmit?: (props : ShoppingListProperties) => void,
}) => {
  const [ title, setTitle ] = useState(initialTitle)
  const [ familyId, setFamilyId ] = useState(initialFamilyId)

  useEffect(() => {
    onChange?.({
      title: title ?? '',
      family_id: familyId,
    })
  }, [title, familyId])

  const onSubmitFn = () => {
    if (!title) return
    onSubmit?.({ title, family_id: familyId })
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
      { showFamilyPicker &&
        <FamilyDropDown
          selectedFamilyId={familyId}
          onChange={setFamilyId}
          />
      }
      <Button mode="contained" disabled={!title} onPress={onSubmitFn}>
        {submitText}
      </Button>
    </View>
  );
}

export default ShoppingListEditor;