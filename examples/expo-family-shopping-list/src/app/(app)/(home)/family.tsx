import React from 'react'
import { View, FlatList } from 'react-native'
import { List, Text } from 'react-native-paper'
import { useElectric } from '../../../components/ElectricProvider'
import { useLiveQuery } from 'electric-sql/react'
import { dummyUserId } from '../../../lib/auth'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Link } from 'expo-router'
import FamilyCard from '../../../components/FamilyCard'

export default function FamilyHome () {
  const { db } = useElectric()!
  const { results: memberships = [] } = useLiveQuery(db.member.liveMany({
    select: {
      member_id: true,
      family_id: true
    },
    where: {
      user_id: dummyUserId
    },
  }))
  return (
    <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
      <View style={{ flex: 1, paddingHorizontal: 16 }}>
        <List.Section style={{ flex: 1 }}>
          <List.Subheader>Your Families</List.Subheader>
          { memberships.length > 0 ?
            <FlatList
              style={{ padding: 6 }}
              data={memberships}
              renderItem={(item) => (
                <Link href={`/family/${item.item.family_id}`} asChild>
                  <FamilyCard memberId={item.item.member_id} />
                </Link>
              )}
              ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
              keyExtractor={(item) => item.member_id}
              />
            :
            <View style={{ flexDirection:'column', alignItems: 'center' }}>
              <Text variant="bodyLarge">You are not part of any family</Text>
            </View>
          }
        </List.Section>
      </View>
    </SafeAreaView>
  )
}
