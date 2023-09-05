// import { ArrowDropDown, ArrowRight } from '@material-ui/icons';
import { MdArrowDropDown, MdArrowRight } from 'react-icons/md';
import * as React from 'react';
import { useState } from 'react';

interface Props {
  title: string;
  children: React.ReactNode;
}
function ItemGroup({ title, children }: Props) {
  const [showItems, setshowItems] = useState(true);

  let Icon = showItems ? MdArrowDropDown : MdArrowRight;
  return (
    <div className="flex flex-col w-full text-sm">
      <div
        className="px-2 relative w-full mt-0.5 h-7 flex items-center rounded hover:bg-gray-100 cursor-pointer"
        onClick={() => setshowItems(!showItems)}
      >
        <Icon className="w-3 h-3 mr-2 -ml-1" />
        {title}
      </div>
      {showItems && children}
    </div>
  );
}

export default ItemGroup;
