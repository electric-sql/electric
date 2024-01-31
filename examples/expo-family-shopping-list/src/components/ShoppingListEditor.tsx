import React, { useEffect, useState } from 'react'
import { View } from 'react-native'
import { TextInput, Button } from 'react-native-paper'
import DropDown from 'react-native-paper-dropdown'
import { Shopping_list } from '../generated/client'

export type ShoppingListProperties = Pick<Shopping_list, 'title'>

const ShoppingListEditor = ({
  initialTitle,
  selectedFamilyId,
  familyIdOptions = [],
  submitText,
  onChange,
  onSubmit,
} : {
  initialTitle?: string,
  selectedFamilyId?: string,
  familyIdOptions?: {value: string, label: string}[],
  submitText: string,
  onChange?: (props : ShoppingListProperties) => void,
  onSubmit?: (props : ShoppingListProperties) => void,
}) => {
  const [ showFamilyDropdown, setShowFamilyDropdown ] = useState(false)
  const [ title, setTitle ] = useState(initialTitle)
  const [ familyId, setFamilyId ] = useState(selectedFamilyId ?? familyIdOptions[0].value)

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
      <View pointerEvents={familyIdOptions.length > 1 ? 'auto' : 'none'}>
        <DropDown
          label="Family"
          mode="outlined"
          visible={showFamilyDropdown}
          showDropDown={() => setShowFamilyDropdown(true)}
          onDismiss={() => setShowFamilyDropdown(false)}
          value={familyId}
          setValue={setFamilyId}
          list={familyIdOptions}
        />
      </View>
      <Button mode="contained" disabled={!title} onPress={onSubmitFn}>
        {submitText}
      </Button>
    </View>
  );
}

export default ShoppingListEditor;