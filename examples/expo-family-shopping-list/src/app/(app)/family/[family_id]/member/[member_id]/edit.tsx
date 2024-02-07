import { useLiveQuery } from 'electric-sql/react';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { TextInput, Button } from 'react-native-paper';

import { useElectric } from '../../../../../../components/ElectricProvider';
import ImagePicker from '../../../../../../components/ImagePicker';

export default function EditMember() {
  const { member_id } = useLocalSearchParams<{ member_id?: string }>();
  if (!member_id) return <Redirect href="/families" />;

  const [name, setName] = useState<string>();
  const [imageBase64, setImageBase64] = useState<string>();
  const { db } = useElectric()!;
  const { results: member } = useLiveQuery(
    db.member.liveUnique({
      where: {
        member_id,
      },
    }),
  );

  useEffect(() => {
    if (name === undefined && member?.name !== undefined) {
      setName(member.name);
    }
  }, [member?.name]);

  const onSubmit = useCallback(() => {
    if (!name) return;
    db.member.update({
      data: {
        name,
        image_base_64: imageBase64,
      },
      where: {
        member_id,
      },
    });
    router.back();
  }, [name, member_id, imageBase64]);

  if (!member) return null;
  return (
    <View style={{ gap: 16 }}>
      <ImagePicker
        initialImage={member.image_base_64}
        aspectRatio={1}
        onImagePicked={setImageBase64}
      />
      <TextInput
        mode="outlined"
        autoFocus
        error={!name}
        label="Name"
        value={name}
        onChangeText={setName}
        onSubmitEditing={onSubmit}
      />
      <Button mode="contained" disabled={!name} onPress={onSubmit}>
        Save
      </Button>
    </View>
  );
}
