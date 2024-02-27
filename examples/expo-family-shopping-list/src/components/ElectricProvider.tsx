import { electrify } from 'electric-sql/expo';
import { makeElectricContext } from 'electric-sql/react';
import * as SQLite from 'expo-sqlite';
import React, { useEffect, useState } from 'react';

import LoadingView from './LoadingView';
import { DEBUG_MODE, ELECTRIC_URL } from '../config';
import { Electric, schema } from '../generated/client';

const { ElectricProvider: ElectricProviderWrapper, useElectric } = makeElectricContext<Electric>();

function getElectricDbName(userId: string = 'unauthed') {
  return `shopping_list_${userId}.db`;
}

export { useElectric };

export default function ElectricProvider({
  children,
  userId,
  accessToken,
}: {
  children: React.ReactNode;
  userId: string;
  accessToken: string;
}) {
  const [electric, setElectric] = useState<Electric>();
  useEffect(() => {
    // if no access token is present, clean up existing instance
    // and do not initialize electric
    if (!accessToken || !userId) {
      electric?.close();
      setElectric(undefined);
      return;
    }

    let isMounted = true;

    const init = async () => {
      const config = {
        debug: DEBUG_MODE,
        url: ELECTRIC_URL,
      };

      const conn = SQLite.openDatabase(getElectricDbName(userId));
      const electric = await electrify(conn, schema, config);
      await electric.connect(accessToken);
      if (!isMounted) return;

      const shape = await electric.db.member.sync({
        include: {
          family: {
            include: {
              shopping_list: {
                include: {
                  shopping_list_item: true,
                },
              },
            },
          },
        },
      });

      await shape.synced;

      setElectric(electric);
    };

    init();

    return () => {
      isMounted = false;
      electric?.close();
    };
  }, [accessToken, userId]);

  if (electric === undefined) {
    return <LoadingView />;
  }

  return <ElectricProviderWrapper db={electric}>{children}</ElectricProviderWrapper>;
}
