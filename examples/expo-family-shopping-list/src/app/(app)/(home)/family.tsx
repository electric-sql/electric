import { useLiveQuery } from 'electric-sql/react';
import { Link } from 'expo-router';
import React, { useCallback } from 'react';
import { View, FlatList } from 'react-native';
import { Button, List, Text } from 'react-native-paper';

import { useAuthenticatedUser } from '../../../components/AuthProvider';
import { useElectric } from '../../../components/ElectricProvider';
import FamilyCard from '../../../components/FamilyCard';
import FlatListSeparator from '../../../components/FlatListSeparator';

export default function FamilyHome() {
  const userId = useAuthenticatedUser()!;
  const { db } = useElectric()!;
  const { results: memberships = [] } = useLiveQuery(
    db.member.liveMany({
      include: {
        family: {
          select: {
            name: true,
            creator_user_id: true,
            image_base_64: true,
          },
        },
      },
      where: { user_id: userId },
    }),
  );

  const onLeave = useCallback(
    (memberId: string) =>
      db.member.delete({
        where: { member_id: memberId },
      }),
    [],
  );

  return (
    <View style={{ flex: 1 }}>
      <List.Section style={{ flex: 1 }}>
        <List.Subheader>Your Families</List.Subheader>
        {memberships.length > 0 ? (
          <FlatList
            contentContainerStyle={{ padding: 6 }}
            data={memberships}
            renderItem={(item) => <FamilyCard membership={item.item} onLeave={onLeave} />}
            ItemSeparatorComponent={() => <FlatListSeparator />}
            keyExtractor={(item) => item.member_id}
          />
        ) : (
          <View style={{ flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <Text variant="bodyLarge">You are not part of any family</Text>
            <Link href="/personal_code" asChild>
              <Button mode="contained">Join a family</Button>
            </Link>
          </View>
        )}
      </List.Section>
    </View>
  );
}
