import { useLiveQuery } from 'electric-sql/react';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { View } from 'react-native';

import { useElectric } from '../../../../../../components/ElectricProvider';
import ShoppingListItemEditor, {
  ShoppingListItemProperties,
} from '../../../../../../components/ShoppingListItemEditor';

export default function EditShoppingListItem() {
  const { item_id } = useLocalSearchParams<{ item_id: string }>();
  if (!item_id) return <Redirect href="../" />;
  const { db } = useElectric()!;
  const { results: item } = useLiveQuery(
    db.shopping_list_item.liveUnique({
      where: { item_id },
    }),
  );

  const onUpdate = async (props: ShoppingListItemProperties) => {
    await db.shopping_list_item.update({
      data: {
        name: props.name,
        quantity: props.quantity,
        comment: props.comment,
        image_base_64: props.image_base_64,
        updated_at: new Date(),
      },
      where: {
        item_id,
      },
    });

    // TODO(msfstef): should live in same transaction
    await db.shopping_list.update({
      data: { updated_at: new Date() },
      where: { list_id: item.list_id },
    });

    router.back();
  };

  if (!item) return null;
  return (
    <View>
      <ShoppingListItemEditor
        initialName={item.name}
        initialQuantity={item.quantity}
        initialComment={item.comment}
        initialImage={item.image_base_64}
        onSubmit={onUpdate}
        submitText="Update"
      />
    </View>
  );
}
