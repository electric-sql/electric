import React, {useEffect} from 'react';
import {Image, Pressable, Text, View} from 'react-native';
import {useLiveQuery} from 'electric-sql/react';
import {genUUID} from 'electric-sql/util';
import {Items as Item} from './generated/client';
import {styles} from './styles';
import {useElectric} from './ElectricProvider';

export const Example = () => {
  const {db} = useElectric()!;
  const {results} = useLiveQuery(db.items.liveMany());

  useEffect(() => {
    const syncItems = async () => {
      // Resolves when the shape subscription has been established.
      const shape = await db.items.sync();

      // Resolves when the initial data for the shape
      // has been synced into the local database.
      await shape.synced;
    };

    syncItems();
  }, [db.items]);

  const addItem = async () => {
    await db.items.create({
      data: {
        value: genUUID(),
      },
    });
  };

  const clearItems = async () => {
    await db.items.deleteMany();
  };

  const items: Item[] = results ?? [];

  return (
    <View style={styles.container}>
      <View style={styles.iconContainer}>
        <Image source={require('../assets/icon.png')} />
      </View>
      <View style={styles.buttons}>
        <Pressable style={styles.button} onPress={addItem}>
          <Text style={styles.text}>Add</Text>
        </Pressable>
        <Pressable style={styles.button} onPress={clearItems}>
          <Text style={styles.text}>Clear</Text>
        </Pressable>
      </View>
      <View style={styles.items}>
        {items.map((item: Item, index: number) => (
          <Text key={index} style={styles.item}>
            {item.value}
          </Text>
        ))}
      </View>
    </View>
  );
};
