import React from 'react'
import { View, FlatList } from 'react-native'
import { List, Text } from 'react-native-paper'
import { useElectric } from '../../../components/ElectricProvider'
import { useLiveQuery } from 'electric-sql/react'
import { Redirect, Stack, useLocalSearchParams } from 'expo-router'
import MemberCard from '../../../components/MemberCard'

export default function Family () {
  const { family_id } = useLocalSearchParams<{ family_id?: string }>()
  if (!family_id) return <Redirect href="/families" />

  const { db } = useElectric()!
  const { results: family } = useLiveQuery(db.family.liveUnique({
    include: {
      member: {
        select: {
          member_id: true
        }
      }
    },
    where: {
      family_id: family_id
    }
  }))

  if (!family) return null
  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen
        options={{
          headerTitle: family.name
        }}
      />
      <List.Section>
        <List.Subheader>Members</List.Subheader>
        <FlatList
          style={{ padding: 8 }}
          data={family.member ?? []}
          renderItem={(item) => <MemberCard memberId={item.item.member_id} />}
          keyExtractor={(item) => item.member_id}
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        />
      </List.Section>
    </View>
  )
}

