import * as Y from 'yjs'

export function extractTextFromXmlFragment(xmlFragment: Y.XmlFragment) {
  const text = []
  for (const node of xmlFragment.createTreeWalker(
    (node) => node instanceof Y.Text
  )) {
    text.push(Y.Text.prototype.toString.call(node))
  }
  return text.join('')
}
