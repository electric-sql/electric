import * as ExpoImagePicker from 'expo-image-picker';
import React, { useState } from 'react';
import { Image } from 'react-native';
import { Surface, Text, TouchableRipple } from 'react-native-paper';

const ImagePicker = ({
  aspectRatio = 1,
  initialImage,
  onImagePicked,
  minHeight = 100,
}: {
  aspectRatio?: number;
  initialImage?: string;
  onImagePicked?: (imageBase64: string) => void;
  minHeight?: number;
}) => {
  const [image, setImage] = useState(initialImage);

  const pickImage = async () => {
    // No permissions request is necessary for launching the image library
    const result = await ExpoImagePicker.launchImageLibraryAsync({
      mediaTypes: ExpoImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, aspectRatio],
      base64: true,
    });
    if (!result.canceled && result.assets[0].base64) {
      const imageUri = 'data:image/jpeg;base64,' + result.assets[0].base64;
      setImage(imageUri);
      onImagePicked?.(imageUri);
    }
  };

  return (
    <TouchableRipple onPress={pickImage}>
      <Surface
        mode="flat"
        elevation={1}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight,
        }}>
        {image ? (
          <Image source={{ uri: image }} style={{ flex: 1, aspectRatio }} />
        ) : (
          <Text variant="bodyLarge" style={{ padding: 12 }}>
            Add an image
          </Text>
        )}
      </Surface>
    </TouchableRipple>
  );
};

export default ImagePicker;
