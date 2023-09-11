import React, {useEffect} from "react";
import AceEditor from 'react-ace';

import "ace-builds/src-noconflict/mode-pgsql";
import "ace-builds/src-noconflict/theme-github";
import "ace-builds/src-noconflict/ext-language_tools";


export default function SQLTab(): JSX.Element {


    function onChange(newValue) {
      console.log("change", newValue);
    }

    return (<AceEditor
        mode="pgsql"
        theme="github"
        onChange={onChange}
        readOnly={false}
        name="editor"
        editorProps={{ $blockScrolling: true }}
      />);

}