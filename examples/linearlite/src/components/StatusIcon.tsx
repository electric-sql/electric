import { ReactComponent as CancelIcon } from '../assets/icons/cancel.svg';
import { ReactComponent as BacklogIcon } from '../assets/icons/circle-dot.svg';
import { ReactComponent as TodoIcon } from '../assets/icons/circle.svg';
import { ReactComponent as DoneIcon } from '../assets/icons/done.svg';
import { ReactComponent as InProgressIcon } from '../assets/icons/half-circle.svg';
import classNames from 'classnames';
import React from 'react';
import { Status } from '../types/issue';

interface Props {
  status: string;
  className?: string;
}

const statusIcons = {
  [Status.BACKLOG]: BacklogIcon,
  [Status.TODO]: TodoIcon,
  [Status.IN_PROGRESS]: InProgressIcon,
  [Status.DONE]: DoneIcon,
  [Status.CANCELED]: CancelIcon,
};

export default function StatusIcon({ status, className }: Props) {
  // console.log("***********", status);
  //
  // let classes = classNames('w-3.5 h-3.5 rounded', className);
  //
  // return <img src={statusIcons[status]} className={classes} />;
  let classes = classNames('w-3.5 h-3.5 rounded', className);

  const Icon = statusIcons[status.toLowerCase()]

  return <Icon className={classes} />;
}





