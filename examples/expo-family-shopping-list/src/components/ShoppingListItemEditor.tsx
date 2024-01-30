import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { TextInput } from 'react-native-paper';

import { Shopping_list_item } from '../generated/client';


export type ShoppingListItemProperties = Pick<Shopping_list_item, 'name' | 'quantity' | 'comment'>

const ShoppingListItemEditor = ({
  initialName = '',
  initialQuantity = 1,
  onChange,
  onSubmit,
} : {
  initialName?: string,
  initialQuantity?: number,
  onChange: (props : ShoppingListItemProperties) => void,
  onSubmit?: (props: ShoppingListItemProperties) => void,
}) => {
  const [ name, setName ] = useState(initialName)
  const [ quantity, setQuantity ] = useState(initialQuantity)
  const [ comment, setComment ] = useState('')


  const getProps = () => ({
    name,
    quantity,
    comment
  })

  useEffect(() => {
    onChange(getProps())
  }, [name, quantity, comment])

  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <TextInput
          autoFocus
          style={{ flex: 1 }}
          mode="outlined"
          label="Name"
          onSubmitEditing={() => onSubmit?.(getProps())}
          placeholder="e.g. bin liner"
          value={name}
          onChangeText={setName}
        />
        <TextInput
          mode="outlined"
          label="Quantity"
          keyboardType='numeric'
          style={{ maxWidth: 120 }}
          onChangeText={(text)=> setQuantity(Number(text))}
          readOnly
          value={quantity.toString()}
          left={<TextInput.Icon icon="minus" onPress={() => setQuantity((q) => Math.max(1, q - 1))} />}
          right={<TextInput.Icon icon="plus" onPress={() => setQuantity((q) => q +1)}/>}
          />
      </View>
          
      <TextInput
        label="Comments"
        style={{ minHeight: 100 }}
        mode="outlined"
        onSubmitEditing={() => onSubmit?.(getProps())}
        placeholder="e.g. the ones with the lavender smell"
        multiline
        value={comment}
        onChangeText={setComment}
      />
    </View>
  );
}

export default ShoppingListItemEditor;