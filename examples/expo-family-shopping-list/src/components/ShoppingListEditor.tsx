import React, { useEffect, useState } from 'react';
import { View, TextInput, Text, StyleSheet } from 'react-native';
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
    <View style={styles.container}>
      <Text style={styles.title}>Title</Text>
      <TextInput
        style={styles.input}
        onSubmitEditing={() => onSubmit?.({ title })}
        placeholder="Your shopping list's name"
        value={title}
        onChangeText={setTitle}
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

export default ShoppingListEditor;