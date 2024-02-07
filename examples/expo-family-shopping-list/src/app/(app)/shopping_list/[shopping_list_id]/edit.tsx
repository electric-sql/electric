import { useLiveQuery } from 'electric-sql/react';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { View } from 'react-native';

import { useElectric } from '../../../../components/ElectricProvider';
import ShoppingListEditor, {
  ShoppingListProperties,
} from '../../../../components/ShoppingListEditor';

export default function AddShoppingList() {
  const { shopping_list_id } = useLocalSearchParams<{ shopping_list_id: string }>();
  if (!shopping_list_id) return <Redirect href="../" />;
  const { db } = useElectric()!;
  const { results: shoppingList } = useLiveQuery(
    db.shopping_list.liveUnique({
      where: {
        list_id: shopping_list_id,
      },
    }),
  );

  const onUpdate = async (props: ShoppingListProperties) => {
    await db.shopping_list.update({
      data: {
        title: props.title,
        updated_at: new Date(),
      },
      where: {
        list_id: shopping_list_id,
      },
    });
    router.back();
  };

  if (!shoppingList) return null;
  return (
    <View>
      <ShoppingListEditor
        initialTitle={shoppingList.title}
        initialFamilyId={shoppingList.family_id}
        disableFamilyPicker
        onSubmit={onUpdate}
        submitText="Update"
      />
    </View>
  );
}
