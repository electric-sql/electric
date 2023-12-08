import React, { useEffect, useState } from 'react'
import { useElectric } from './ElectricWrapper'
import { useLiveQuery } from 'electric-sql/react'
import { Users } from './generated/client';

import './TabPicker.css';

type TabKey = number | string;
interface TabItem {
  key: TabKey;
  value: string;
}

export const TabPicker = ({
  items,
  selected,
  onSelected
}: {
  items: TabItem[],
  selected: TabKey,
  onSelected: (key: TabKey) => void
}) => {

  return (
    <ul className="tabContainer">
    {
      items.map((item: TabItem, idx) => (
        <li key={item.key} className="me-2">
          <a href="#" className={"tab" + (item.key === selected ? " active": "")}
            onClick={() => onSelected(item.key)}>
            {item.value}
          </a>
        </li>
      ))
    }
  </ul>
  )
}
