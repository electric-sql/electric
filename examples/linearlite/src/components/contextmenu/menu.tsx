import classnames from 'classnames';
import React, { ReactNode, useEffect, useRef } from 'react';
import { ContextMenu, MenuItem } from '@firefox-devtools/react-contextmenu';

const sizeClasses = {
  small: 'w-34',
  normal: 'w-72',
};

export interface MenuProps {
  id: string;
  size: 'small' | 'normal';
  className?: string;
  onKeywordChange?: (kw: string) => void;
  filterKeyword: boolean;
  children: ReactNode;
  searchPlaceholder?: string;
}

interface MenuItemProps {
  children: ReactNode;
  onClick?: Function;
}
const Item = function ({ onClick, children }: MenuItemProps) {
  return (
    <MenuItem
      className="flex items-center h-8 px-3 text-gray-500 focus:outline-none hover:text-gray-800 hover:bg-gray-100"
      onClick={onClick}
      //@ts-ignore
      tabIndex="0"
    >
      {children}
    </MenuItem>
  );
};

export const Menu = (props: MenuProps) => {
  let {
    id,
    size,
    onKeywordChange,
    children,
    className,
    filterKeyword,
    searchPlaceholder,
    ...restProps
  } = props;
  const ref = useRef<HTMLInputElement>(null);

  const classes = classnames(
    'cursor-default bg-white rounded shadow-modal z-100',
    sizeClasses[size],
    className
  );

  return (
    <ContextMenu
      id={id}
      className={classes}
      onShow={() => {
        if (ref.current) ref.current.focus();
      }}
    >
      <div
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        {filterKeyword && (
          <input
            className="text-sm font-normal flex-0 w-full placeholder-gray-400 px-3.5 py-2.5 rounded border border-gray-200 focus:outline-none"
            ref={ref}
            onChange={(e) => {
              //TODO: use debounced call
              if (onKeywordChange) onKeywordChange(e.target.value);
            }}
            onClick={(e) => {
              e.stopPropagation();
            }}
            placeholder={searchPlaceholder}
          />
        )}
        {children}
      </div>
    </ContextMenu>
  );
};

Menu.Item = Item;
Menu.defaultProps = {
  size: 'small',
};
