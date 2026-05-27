import { BrowserWindow, Menu, clipboard, shell } from 'electron'
import type { DesktopContextMenuRequest } from '../shared/types'

export function isExternalLink(protocols: Set<string>, url: string): boolean {
  try {
    return protocols.has(new URL(url).protocol)
  } catch {
    return false
  }
}

export function installExternalLinkHandler(
  protocols: Set<string>,
  win: BrowserWindow
): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalLink(protocols, url)) {
      void shell.openExternal(url)
    }
    return { action: `deny` }
  })

  win.webContents.on(`will-navigate`, (event, url) => {
    if (!isExternalLink(protocols, url)) return
    event.preventDefault()
    void shell.openExternal(url)
  })
}

export function installEditableContextMenu(
  protocols: Set<string>,
  win: BrowserWindow
): void {
  win.webContents.on(`context-menu`, (_event, params) => {
    if (params.linkURL && isExternalLink(protocols, params.linkURL)) {
      showLinkContextMenu(win, params.linkURL)
      return
    }

    if (!params.isEditable) return

    const template: Array<Electron.MenuItemConstructorOptions> = []
    const suggestions = params.dictionarySuggestions.slice(0, 5)

    if (params.misspelledWord) {
      if (suggestions.length > 0) {
        for (const suggestion of suggestions) {
          template.push({
            label: suggestion,
            click: () => win.webContents.replaceMisspelling(suggestion),
          })
        }
      } else {
        template.push({ label: `No Guesses Found`, enabled: false })
      }

      template.push({
        label: `Learn Spelling`,
        click: () => {
          win.webContents.session.addWordToSpellCheckerDictionary(
            params.misspelledWord
          )
        },
      })
      template.push({ type: `separator` })
    }

    template.push(
      { role: `undo`, enabled: params.editFlags.canUndo },
      { role: `redo`, enabled: params.editFlags.canRedo },
      { type: `separator` },
      { role: `cut`, enabled: params.editFlags.canCut },
      { role: `copy`, enabled: params.editFlags.canCopy },
      { role: `paste`, enabled: params.editFlags.canPaste },
      {
        role: `pasteAndMatchStyle`,
        enabled: params.editFlags.canPaste,
      },
      { role: `delete`, enabled: params.editFlags.canDelete },
      { type: `separator` },
      { role: `selectAll`, enabled: params.editFlags.canSelectAll }
    )

    Menu.buildFromTemplate(template).popup({ window: win })
  })
}

function showLinkContextMenu(win: BrowserWindow, url: string): void {
  Menu.buildFromTemplate([
    {
      label: `Open Link in Browser`,
      click: () => {
        void shell.openExternal(url)
      },
    },
    {
      label: `Copy Link`,
      click: () => clipboard.writeText(url),
    },
  ]).popup({ window: win })
}

export function showSelectionContextMenu(
  win: BrowserWindow,
  request: DesktopContextMenuRequest
): void {
  const selectionText = request.selectionText.trim()
  if (selectionText.length === 0) return

  Menu.buildFromTemplate([
    {
      label: `Copy`,
      accelerator: `CmdOrCtrl+C`,
      click: () => clipboard.writeText(selectionText),
    },
  ]).popup({ window: win })
}
