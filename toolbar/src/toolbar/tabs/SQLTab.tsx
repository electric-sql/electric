import { useEffect, useState } from 'react'
// import AceEditor from 'react-ace';

// import "ace-builds/src-noconflict/mode-pgsql";
// import "ace-builds/src-noconflict/theme-github";
// import "ace-builds/src-noconflict/ext-language_tools";

export default function SQLTab(dbName: string): JSX.Element {
  const [status, setStatus] = useState('')

  useEffect(() => {
    console.log(dbName)
  }, [])

  // function onChange(newValue) {
  //   console.log("change", newValue);
  // }
  //
  // return (<AceEditor
  //     mode="pgsql"
  //     theme="github"
  //     onChange={onChange}
  //     readOnly={false}
  //     name="editor"
  //     editorProps={{ $blockScrolling: true }}
  //   />);

  return <div>SQL coming soon</div>
}
