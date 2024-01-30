import React, { useState } from 'react';
import { View, TextInput, Text } from 'react-native';


export interface ShoppingListProperties {
  title: string
}

const ShoppingListEditor = ({
  initialTitle,
  onChange,
} : {
  initialTitle?: string,
  onChange: (props : ShoppingListProperties) => void,
}) => {
  const [ title, setTitle ] = useState(initialTitle ?? '')

  const changeHandler = () => onChange({
    title
  })

  const setTitleHandler = (val: string) => {
    setTitle(val)
    changeHandler();
  }

  return (
    <View>
      <Text>Title</Text>
      <TextInput value={title} onChangeText={setTitleHandler}/>
    </View>
  );
}

export default ShoppingListEditor;