import React from 'react'
import { View, FlatList } from 'react-native'
import { List, Text } from 'react-native-paper'
import { useElectric } from '../../../components/ElectricProvider'
import { useLiveQuery } from 'electric-sql/react'
import { Link } from 'expo-router'
import FamilyCard from '../../../components/FamilyCard'
import FlatListSeparator from '../../../components/FlatListSeparator'
import { useAuthenticatedUser } from '../../../components/AuthProvider'

export default function FamilyHome () {
  const userId = useAuthenticatedUser()!
  const { db } = useElectric()!
  const { results: memberships = [] } = useLiveQuery(db.member.liveMany({
    select: {
      member_id: true,
      family_id: true
    },
    where: {
      user_id: userId
    },
  }))
  return (
    <View style={{ flex: 1, paddingHorizontal: 16 }}>
      <List.Section style={{ flex: 1 }}>
        <List.Subheader>Your Families</List.Subheader>
        { memberships.length > 0 ?
          <FlatList
            contentContainerStyle={{ padding: 6 }}
            data={memberships}
            renderItem={(item) => (
              <Link href={`/family/${item.item.family_id}`} asChild>
                <FamilyCard memberId={item.item.member_id} />
              </Link>
            )}
            ItemSeparatorComponent={() => <FlatListSeparator />}
            keyExtractor={(item) => item.member_id}
            />
          :
          <View style={{ flexDirection:'column', alignItems: 'center' }}>
            <Text variant="bodyLarge">You are not part of any family</Text>
          </View>
        }
      </List.Section>
    </View>
  )
}
