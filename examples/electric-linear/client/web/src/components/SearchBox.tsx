import React, { ChangeEventHandler, useState } from 'react';
import SearchIcon from '../assets/icons/search.svg';
import classnames from 'classnames';

interface Props {
  placeholder: string;
  //onChange callback
  onChange?: ChangeEventHandler;
  className?: string;
}

function SearchBox(props: Props) {
  const { placeholder, onChange, className } = props;

  const [focus, setFocus] = useState(false);
  return (
    <div className={classnames('relative', className)}>
      <input
        type="search"
        placeholder={placeholder}
        onChange={onChange}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        className="w-full pl-8 pr-6 text-sm font-medium placeholder-gray-700 border border-transparent rounded h-7 ring-0 focus:outline-none focus:placeholder-gray-400 hover:border-gray-100 focus:border-gray-100"
      />
      <SearchIcon
        className={classnames(
          'absolute w-3.5 h-3.5 text-gray-500 left-2 top-2',
          {
            'text-blue-700': focus,
          }
        )}
      />
    </div>
  );
}

SearchBox.defaultProps = {
  placeholder: 'Search',
};

export default SearchBox;
