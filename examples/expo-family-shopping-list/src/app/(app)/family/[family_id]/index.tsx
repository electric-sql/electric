import React from 'react'
import { View, FlatList } from 'react-native'
import { List, Text } from 'react-native-paper'
import { useElectric } from '../../../../components/ElectricProvider'
import { useLiveQuery } from 'electric-sql/react'
import { Redirect, Stack, useLocalSearchParams } from 'expo-router'
import MemberCard from '../../../../components/MemberCard'
import { dummyUserId } from '../../../../lib/auth'
import { Member } from '../../../../generated/client'
import FlatListSeparator from '../../../../components/FlatListSeparator'

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
  if (!family || !family.member) return null
  
  const otherMembers = (family.member ?? []).filter(
    (m: Pick<Member, 'member_id'>) => m.member_id !== dummyUserId
  )
  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen
        options={{
          headerTitle: family.name
        }}
      />
      <List.Section>
        <List.Subheader>Profile</List.Subheader>
        <MemberCard key={dummyUserId} memberId={dummyUserId} editable />

        <List.Subheader>Members</List.Subheader>
        { otherMembers.length > 0 ?
            <FlatList
              style={{ padding: 6 }}
              data={otherMembers}
              renderItem={(item) => <MemberCard memberId={item.item.member_id} />}
              keyExtractor={(item) => item.member_id}
              ItemSeparatorComponent={() => <FlatListSeparator />}
            />
            :
            <View style={{ flexDirection:'column', alignItems: 'center' }}>
              <Text variant="bodyLarge">No other members in this family</Text>
            </View>
          }
        
      </List.Section>
    </View>
  )
}

