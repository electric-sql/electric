import { ReactComponent as CancelIcon } from '../../assets/icons/cancel.svg';
import { ReactComponent as BacklogIcon } from '../../assets/icons/circle-dot.svg';
import { ReactComponent as TodoIcon } from '../../assets/icons/circle.svg';
import { ReactComponent as DoneIcon } from '../../assets/icons/done.svg';
import { ReactComponent as InProgressIcon } from '../../assets/icons/half-circle.svg';
import { Portal } from '../Portal';
import React, { ReactNode, useState } from 'react';
import { ContextMenuTrigger } from '@firefox-devtools/react-contextmenu';
import { Status } from '../../types/issue';
import { Menu } from './menu';

interface Props {
  id: string;
  button: ReactNode;
  className?: string;
  onSelect?: (item: any) => void;
}
export default function StatusMenu({ id, button, className, onSelect }: Props) {
  const [keyword, setKeyword] = useState('');
  const handleSelect = (status: string) => {
    if (onSelect) onSelect(status);
  };

  let statuses = [
    [BacklogIcon, Status.BACKLOG, 'Backlog'],
    [TodoIcon, Status.TODO, 'Todo'],
    [InProgressIcon, Status.IN_PROGRESS, 'In Progress'],
    [DoneIcon, Status.DONE, 'Done'],
    [CancelIcon, Status.CANCELED, 'Canceled'],
  ];
  if (keyword !== '') {
    let normalizedKeyword = keyword.toLowerCase().trim();
    statuses = statuses.filter(
      ([icon, id, l]) => l.toLowerCase().indexOf(normalizedKeyword) !== -1
    );
  }

  let options = statuses.map(([Icon, id, label]) => {
    return (
      <Menu.Item key={`status-${id}`} onClick={() => handleSelect(id)}>
        <Icon className="mr-3" />
        <div className="flex-1 overflow-hidden">{label}</div>
      </Menu.Item>
    );
  });

  return (
    <>
      <ContextMenuTrigger id={id} holdToDisplay={1}>
        {button}
      </ContextMenuTrigger>

      <Portal>
        <Menu
          id={id}
          size="normal"
          filterKeyword={true}
          className={className}
          searchPlaceholder="Set status..."
          onKeywordChange={(kw) => setKeyword(kw)}
        >
          {options}
        </Menu>
      </Portal>
    </>
  );
}
