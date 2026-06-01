import { useCallback, useEffect, useRef, useState } from 'react'
import {
  File as FileIcon,
  Image as ImageIcon,
  Paperclip,
  Plus,
  X,
} from 'lucide-react'
import { formatAttachmentSize } from '../lib/attachments'
import { Icon, Menu, Text } from '../ui'
import styles from './AttachmentDrafts.module.css'

type Focusable = {
  focus: () => void
}

export type AttachmentDraftPolicy = {
  accept?: string
  acceptsMimeType?: (mimeType: string) => boolean
  isAccepted?: (file: File) => boolean
}

const allAttachmentDraftPolicy: AttachmentDraftPolicy = {}

export const imageAttachmentDraftPolicy: AttachmentDraftPolicy = {
  accept: `image/*`,
  acceptsMimeType: (mimeType) => mimeType.startsWith(`image/`),
  isAccepted: (file) => file.type.startsWith(`image/`),
}

function hasDraggedFiles(dataTransfer: DataTransfer): boolean {
  for (const type of dataTransfer.types) {
    if (type === `Files`) return true
  }
  return dataTransfer.files.length > 0
}

function filterAcceptedFiles(
  files: Iterable<File>,
  policy: AttachmentDraftPolicy
): Array<File> {
  const isAccepted = policy.isAccepted
  const candidates = Array.from(files)
  return isAccepted ? candidates.filter(isAccepted) : candidates
}

function hasAcceptedDraggedFile(
  dataTransfer: DataTransfer,
  policy: AttachmentDraftPolicy
): boolean {
  if (!hasDraggedFiles(dataTransfer)) return false
  if (!policy.acceptsMimeType) return true

  const fileItems = Array.from(dataTransfer.items).filter(
    (item) => item.kind === `file`
  )
  if (fileItems.length === 0) return true

  const typedItems = fileItems.filter((item) => item.type)
  if (typedItems.length === 0) return true

  return typedItems.some((item) => policy.acceptsMimeType!(item.type))
}

function clipboardImageExtension(mimeType: string): string {
  switch (mimeType) {
    case `image/jpeg`:
      return `jpg`
    case `image/svg+xml`:
      return `svg`
    default: {
      const subtype = mimeType.split(`/`)[1]?.split(/[+;]/)[0]
      return subtype || `png`
    }
  }
}

function nameClipboardImage(file: File, index: number): File {
  if (file.name.trim()) return file
  const ext = clipboardImageExtension(file.type || `image/png`)
  const suffix = index === 0 ? `` : `-${index + 1}`
  return new File([file], `pasted-image-${Date.now()}${suffix}.${ext}`, {
    type: file.type || `image/png`,
    lastModified: Date.now(),
  })
}

function imageFilesFromClipboard(dataTransfer: DataTransfer): Array<File> {
  const files: Array<File> = []
  for (let index = 0; index < dataTransfer.items.length; index++) {
    const item = dataTransfer.items[index]
    if (item.kind !== `file` || !item.type.startsWith(`image/`)) continue
    const file = item.getAsFile()
    if (file) files.push(nameClipboardImage(file, files.length))
  }
  if (files.length > 0) return files

  return Array.from(dataTransfer.files)
    .filter((file) => file.type.startsWith(`image/`))
    .map((file, index) => nameClipboardImage(file, index))
}

function fileExtension(file: File): string {
  const fromName = file.name.split(`.`).pop()
  if (fromName && fromName !== file.name) return fromName.slice(0, 5)
  const fromMime = file.type.split(`/`)[1]
  return fromMime ? fromMime.split(/[+;]/)[0].slice(0, 5) : `file`
}

export function useAttachmentDrafts({
  policy = allAttachmentDraftPolicy,
  disabled = false,
  focusRef,
}: {
  policy?: AttachmentDraftPolicy
  disabled?: boolean
  focusRef?: { current: Focusable | null }
} = {}): {
  attachments: Array<File>
  clearAttachments: () => void
  dropActive: boolean
  dropZoneProps: {
    onDragEnter: React.DragEventHandler<HTMLElement>
    onDragOver: React.DragEventHandler<HTMLElement>
    onDragLeave: React.DragEventHandler<HTMLElement>
    onDrop: React.DragEventHandler<HTMLElement>
    onDragEnd: React.DragEventHandler<HTMLElement>
  }
  fileInputRef: React.RefObject<HTMLInputElement | null>
  addAttachments: (files: Iterable<File> | null) => void
  openAttachmentPicker: () => void
  handlePaste: React.ClipboardEventHandler<HTMLElement>
  removeAttachment: (index: number) => void
} {
  const [attachments, setAttachments] = useState<Array<File>>([])
  const [dropActive, setDropActive] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragDepthRef = useRef(0)

  const appendAttachments = useCallback((files: Array<File>) => {
    if (files.length === 0) return
    setAttachments((current) => [...current, ...files])
    if (fileInputRef.current) {
      fileInputRef.current.value = ``
    }
  }, [])

  const addAttachments = useCallback(
    (files: Iterable<File> | null) => {
      if (disabled) return
      if (!files) return
      appendAttachments(filterAcceptedFiles(files, policy))
    },
    [appendAttachments, disabled, policy]
  )

  const clearAttachments = useCallback(() => {
    setAttachments([])
    if (fileInputRef.current) {
      fileInputRef.current.value = ``
    }
  }, [])

  const openAttachmentPicker = useCallback(() => {
    if (disabled) return
    fileInputRef.current?.click()
  }, [disabled])

  const resetDropState = useCallback(() => {
    dragDepthRef.current = 0
    setDropActive(false)
  }, [])

  useEffect(() => {
    if (disabled) resetDropState()
  }, [disabled, resetDropState])

  const handleDragEnter = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      if (!hasDraggedFiles(event.dataTransfer)) return
      event.preventDefault()
      event.stopPropagation()
      if (disabled || !hasAcceptedDraggedFile(event.dataTransfer, policy)) {
        resetDropState()
        return
      }
      dragDepthRef.current += 1
      setDropActive(true)
    },
    [disabled, policy, resetDropState]
  )

  const handleDragOver = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      if (!hasDraggedFiles(event.dataTransfer)) return
      event.preventDefault()
      event.stopPropagation()
      if (disabled || !hasAcceptedDraggedFile(event.dataTransfer, policy)) {
        resetDropState()
        event.dataTransfer.dropEffect = `none`
        return
      }
      event.dataTransfer.dropEffect = `copy`
      setDropActive(true)
    },
    [disabled, policy, resetDropState]
  )

  const handleDragLeave = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      if (!hasDraggedFiles(event.dataTransfer)) return
      event.preventDefault()
      event.stopPropagation()
      if (disabled) {
        resetDropState()
        return
      }
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
      if (dragDepthRef.current === 0) setDropActive(false)
    },
    [disabled, resetDropState]
  )

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      if (!hasDraggedFiles(event.dataTransfer)) return
      event.preventDefault()
      event.stopPropagation()
      resetDropState()
      if (disabled) return
      appendAttachments(filterAcceptedFiles(event.dataTransfer.files, policy))
      focusRef?.current?.focus()
    },
    [appendAttachments, disabled, focusRef, policy, resetDropState]
  )

  const handlePaste = useCallback(
    (event: React.ClipboardEvent<HTMLElement>) => {
      const files = imageFilesFromClipboard(event.clipboardData)
      if (files.length === 0) return
      event.preventDefault()
      if (disabled) return
      appendAttachments(files)
    },
    [appendAttachments, disabled]
  )

  const removeAttachment = useCallback((index: number) => {
    setAttachments((current) => current.filter((_, i) => i !== index))
  }, [])

  return {
    attachments,
    clearAttachments,
    dropActive,
    dropZoneProps: {
      onDragEnter: handleDragEnter,
      onDragOver: handleDragOver,
      onDragLeave: handleDragLeave,
      onDrop: handleDrop,
      onDragEnd: resetDropState,
    },
    fileInputRef,
    addAttachments,
    openAttachmentPicker,
    handlePaste,
    removeAttachment,
  }
}

export function AttachmentActionMenu({
  disabled,
  accept,
  fileInputRef,
  onFilesSelected,
  onAttach,
}: {
  disabled: boolean
  accept?: string
  fileInputRef: React.RefObject<HTMLInputElement | null>
  onFilesSelected: (files: FileList | null) => void
  onAttach: () => void
}): React.ReactElement {
  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept={accept}
        multiple
        className={styles.fileInput}
        onChange={(event) => onFilesSelected(event.target.files)}
        disabled={disabled}
      />
      <Menu.Root>
        <Menu.Trigger
          render={
            <button
              type="button"
              aria-label="Message actions"
              title="Message actions"
              className={styles.addMenuTrigger}
              disabled={disabled}
            >
              <Icon icon={Plus} size={2} />
            </button>
          }
        />
        <Menu.Content side="top" align="start" sideOffset={8}>
          <Menu.Item disabled={disabled} onSelect={onAttach}>
            <Icon icon={Paperclip} size={2} />
            <Text size={2}>Attach</Text>
          </Menu.Item>
        </Menu.Content>
      </Menu.Root>
    </>
  )
}

export function AttachmentPreviewTray({
  attachments,
  onRemove,
}: {
  attachments: Array<File>
  onRemove: (index: number) => void
}): React.ReactElement | null {
  if (attachments.length === 0) return null
  return (
    <div className={styles.previewTray}>
      {attachments.map((file, index) => (
        <AttachmentPreview
          key={`${file.name}:${file.size}:${file.lastModified}:${index}`}
          file={file}
          index={index}
          onRemove={onRemove}
        />
      ))}
    </div>
  )
}

function AttachmentPreview({
  file,
  index,
  onRemove,
}: {
  file: File
  index: number
  onRemove: (index: number) => void
}): React.ReactElement {
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const isImage = file.type.startsWith(`image/`)

  useEffect(() => {
    if (!isImage) {
      setImageUrl(null)
      return
    }
    const nextUrl = URL.createObjectURL(file)
    setImageUrl(nextUrl)
    return () => URL.revokeObjectURL(nextUrl)
  }, [file, isImage])

  const name = file.name || `attachment`
  const title = `${name} - ${formatAttachmentSize(file.size)}`

  return (
    <div className={styles.previewTile} title={title}>
      {imageUrl ? (
        <img className={styles.previewImage} src={imageUrl} alt={name} />
      ) : (
        <span className={styles.previewFile}>
          <Icon icon={isImage ? ImageIcon : FileIcon} size={3} />
          <span>{fileExtension(file)}</span>
        </span>
      )}
      <span className={styles.previewName}>{name}</span>
      <button
        type="button"
        aria-label={`Remove ${name}`}
        className={styles.previewRemove}
        onClick={() => onRemove(index)}
      >
        <Icon icon={X} size={1} />
      </button>
    </div>
  )
}
