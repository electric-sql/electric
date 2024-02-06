import React, { useEffect, useState } from 'react'
import { View } from 'react-native'
import { TextInput, Button } from 'react-native-paper'
import { Family } from '../generated/client'
import ImagePicker from './ImagePicker'

export type FamilyProperties = Pick<Family, 'name' | 'image_base_64'>

const FamilyEditor = ({
  initialName,
  initialImage,
  submitText,
  onChange,
  onSubmit,
} : {
  initialName?: string,
  initialImage?: string,
  selectedFamilyId?: string,
  submitText: string,
  onChange?: (props : FamilyProperties) => void,
  onSubmit?: (props : FamilyProperties) => void,
}) => {
  const [ name, setName ] = useState(initialName)
  const [ imageBase64, setImageBase64 ] = useState(initialImage)


  useEffect(() => {
    onChange?.({
      name: name ?? '',
      image_base_64: imageBase64 ?? null
    })
  }, [name])

  const onSubmitFn = () => {
    if (!name) return
    onSubmit?.({
      name,
      image_base_64: imageBase64 ?? null
    })
  }

  return (
    <View style={{ gap: 16 }}>
      <ImagePicker
        initialImage={imageBase64}
        aspectRatio={2}
        onImagePicked={setImageBase64}
      />
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