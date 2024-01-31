import React, { useEffect, useState } from 'react'
import { View } from 'react-native'
import { TextInput, Button } from 'react-native-paper'
import { Family } from '../generated/client'

export type FamilyProperties = Pick<Family, 'name'>

const FamilyEditor = ({
  initialName: initialname,
  submitText,
  onChange,
  onSubmit,
} : {
  initialName?: string,
  selectedFamilyId?: string,
  familyIdOptions?: {value: string, label: string}[],
  submitText: string,
  onChange?: (props : FamilyProperties) => void,
  onSubmit?: (props : FamilyProperties) => void,
}) => {
  const [ name, setName ] = useState(initialname)


  useEffect(() => {
    onChange?.({ name: name ?? '' })
  }, [name])

  const onSubmitFn = () => {
    if (!name) return
    onSubmit?.({ name })
  }

  return (
    <View style={{ gap: 16 }}>
      <TextInput
        label="Name"
        mode="outlined"
        error={name?.length === 0}
        autoFocus
        onSubmitEditing={onSubmitFn}
        placeholder="Your family's name"
        value={name}
        onChangeText={setName}
      />
      <Button mode="contained" disabled={!name} onPress={onSubmitFn}>
        {submitText}
      </Button>
    </View>
  );
}

export default FamilyEditor;