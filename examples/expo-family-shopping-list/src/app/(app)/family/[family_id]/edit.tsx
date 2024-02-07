import { useLiveQuery } from 'electric-sql/react';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import React, { useCallback } from 'react';
import { View } from 'react-native';

import { useElectric } from '../../../../components/ElectricProvider';
import FamilyEditor, { FamilyProperties } from '../../../../components/FamilyEditor';

export default function EditFamily() {
  const { family_id } = useLocalSearchParams<{ family_id: string }>();
  if (!family_id) return <Redirect href="../" />;
  const { db } = useElectric()!;
  const { results: { name, image_base_64 } = {} } = useLiveQuery<{
    name: string;
    image_base_64?: string;
  }>(
    db.family.liveUnique({
      select: {
        name: true,
        image_base_64: true,
      },
      where: {
        family_id,
      },
    }),
  );

  const onUpdate = useCallback(
    async (props: FamilyProperties) => {
      await db.family.update({
        data: {
          name: props.name,
          image_base_64: props.image_base_64,
        },
        where: {
          family_id,
        },
      });
      router.back();
    },
    [family_id],
  );

  if (!name) return null;
  return (
    <View>
      <FamilyEditor
        initialName={name}
        initialImage={image_base_64}
        onSubmit={onUpdate}
        submitText="Update"
      />
    </View>
  );
}
