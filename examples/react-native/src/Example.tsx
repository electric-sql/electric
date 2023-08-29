import React, { useEffect, useState } from 'react'
import { Image, Pressable, Text, View } from 'react-native'

import SQLite from 'react-native-sqlite-storage'

import { electrify } from 'electric-sql/react-native'
import { makeElectricContext, useLiveQuery } from 'electric-sql/react'
import { genUUID } from 'electric-sql/util'

import { authToken } from './auth'
import { DEBUG_MODE, ELECTRIC_URL } from './config'
import { Electric, Items as Item, schema } from './generated/client'
import { styles } from './styles'

const { ElectricProvider, useElectric } = makeElectricContext<Electric>()

const promisesEnabled = true
SQLite.enablePromise(promisesEnabled)

export const Example = () => {
  const [ electric, setElectric ] = useState<Electric>()

  useEffect(() => {
    let isMounted = true

    const init = async () => {
      const config = {
        auth: {
          token: authToken()
        },
        debug: DEBUG_MODE,
        url: ELECTRIC_URL
      }

      const conn = await SQLite.openDatabase('electric.db')
      const electric = await electrify(conn, schema, promisesEnabled, config)

      if (!isMounted) {
        return
      }

      if (!isMounted) {
        return
      }

      setElectric(electric)
    }

    init()

    return () => {
      isMounted = false
    }
  }, [])

  if (electric === undefined) {
    return null
  }

  return (
    <ElectricProvider db={electric}>
      <ExampleComponent />
    </ElectricProvider>
  )
}

const ExampleComponent = () => {
  const { db } = useElectric()!
  const { results } = useLiveQuery(
    db.items.liveMany()
  )

  useEffect(() => {
    const syncItems = async () => {
      // Resolves when the shape subscription has been established.
      const shape = await db.items.sync()

      // Resolves when the data has been synced into the local database.
      await shape.synced
    }

    syncItems()
  }, [])

  const addItem = async () => {
    await db.items.create({
      data: {
        value: genUUID(),
      }
    })
  }

  const clearItems = async () => {
    await db.items.deleteMany()
  }

  const items: Item[] = results ?? []

  return (
    <View>
      <View style={ styles.iconContainer }>
        <Image source={require('../assets/icon.png')} />
      </View>
      <View style={ styles.buttons }>
        <Pressable style={ styles.button } onPress={ addItem }>
          <Text style={ styles.text }>
            Add
          </Text>
        </Pressable>
        <Pressable style={ styles.button } onPress={ clearItems }>
          <Text style={ styles.text }>
            Clear
          </Text>
        </Pressable>
      </View>
      <View style={ styles.items }>
        {items.map((item: Item, index: number) => (
          <Text key={ index } style={ styles.item }>
            Item { index + 1 }
          </Text>
        ))}
      </View>
    </View>
  )
}
