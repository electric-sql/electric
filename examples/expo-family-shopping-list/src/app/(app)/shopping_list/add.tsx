import { useLiveQuery } from 'electric-sql/react';
import { genUUID } from 'electric-sql/util';
import { router } from 'expo-router';
import React from 'react';
import { View } from 'react-native';

import { useAuthenticatedUser } from '../../../components/AuthProvider';
import { useElectric } from '../../../components/ElectricProvider';
import ShoppingListEditor, { ShoppingListProperties } from '../../../components/ShoppingListEditor';
import LoadingView from '../../../components/LoadingView';

export default function AddShoppingList() {
  const userId = useAuthenticatedUser()!;
  const { db } = useElectric()!;
  const { results: family } = useLiveQuery<{ family_id: string }>(
    db.family.liveFirst({
      select: {
        family_id: true,
      },
      where: {
        creator_user_id: userId,
      },
    }),
  );

  const onCreate = async (props: ShoppingListProperties) => {
    const newListId = genUUID();
    await db.shopping_list.create({
      data: {
        list_id: newListId,
        family_id: props.family_id,
        title: props.title,
        updated_at: new Date(),
        created_at: new Date(),
      },
    });
    router.replace(`/shopping_list/${newListId}`);
  };

  if (!family) return <LoadingView />;
  return (
    <View>
      <ShoppingListEditor
        initialFamilyId={family.family_id}
        onSubmit={onCreate}
        submitText="Create"
      />
    </View>
  );
}
