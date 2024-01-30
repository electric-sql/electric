import React, { useEffect, useState } from 'react';
import { View, TextInput, Text, StyleSheet } from 'react-native';
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
    <View style={styles.container}>
      <Text style={styles.title}>Title</Text>
      <View style={{ display: 'flex', flexDirection: 'row' }}>
        <TextInput
          style={[styles.input, { flex: 1 }]}
          onSubmitEditing={() => onSubmit?.(getProps())}
          placeholder="e.g. bin liner"
          value={name}
          onChangeText={setName}
        />
        <TextInput 
            style={styles.input}
            keyboardType='numeric'
            onChangeText={(text)=> {
              if (/^\d+$/.test(text.toString())) { 
                setQuantity(Number(text))
              }
            }}
            value={quantity.toString()}
            maxLength={2}
          />
      </View>
      <TextInput
        style={styles.input}
        onSubmitEditing={() => onSubmit?.(getProps())}
        placeholder="e.g. the ones with the lavender smell"
        value={comment}
        onChangeText={setComment}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    margin: 12,
  },
  title: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 6
  },
  input: {
    height: 40,
    borderColor: 'gray',
    borderWidth: 1,
    paddingLeft: 10,
    borderRadius: 5,
    color: 'black', // Customize the input text color
  },
});

export default ShoppingListItemEditor;