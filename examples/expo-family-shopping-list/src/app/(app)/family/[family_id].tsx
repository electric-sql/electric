import React from 'react'
import {
  View
} from 'react-native'
import { useElectric } from '../../../components/ElectricProvider'
import { useLiveQuery } from 'electric-sql/react'
import { useLocalSearchParams } from 'expo-router'

export default function Family () {
  const { family_id } = useLocalSearchParams<{ family_id?: string }>()
  const { db } = useElectric()!


  return (
    <View>

    </View>
  )
}

