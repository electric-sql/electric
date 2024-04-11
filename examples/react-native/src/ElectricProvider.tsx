import React, {useEffect, useState} from 'react';
import {authToken} from './auth';
import {DEBUG_MODE, ELECTRIC_URL} from './config';
import {Electric, schema} from './generated/client';

import {open as openSQLiteConnection} from '@op-engineering/op-sqlite';

import {electrify} from 'electric-sql/op-sqlite';
import {makeElectricContext} from 'electric-sql/react';

const {ElectricProvider, useElectric} = makeElectricContext<Electric>();

const ElectricProviderComponent = ({children}: {children: React.ReactNode}) => {
  const [electric, setElectric] = useState<Electric>();

  useEffect(() => {
    let isMounted = true;

    const init = async () => {
      const config = {
        debug: DEBUG_MODE,
        url: ELECTRIC_URL,
      };

      const dbName = 'electric.db';
      const conn = openSQLiteConnection({name: dbName});
      const client = await electrify(conn, dbName, schema, config);
      await client.connect(authToken());

      if (!isMounted) {
        return;
      }

      setElectric(client);
    };

    init();

    return () => {
      isMounted = false;
    };
  }, []);

  if (electric === undefined) {
    return null;
  }

  return <ElectricProvider db={electric}>{children}</ElectricProvider>;
};

export {ElectricProviderComponent as ElectricProvider, useElectric};
