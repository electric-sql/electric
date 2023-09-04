import React from 'react'

const styles = {
  color: '#f5f5f5',
  padding: '0'
}

const RenderCode = ({ children }) => {
  // XXX todo: dynamic highlighting with docusaurus.

  return (
    <pre><code style={styles}>{children}</code></pre>
  )
}

export default RenderCode
