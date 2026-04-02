import { useEffect, useRef, useState } from 'react'
import type { JSONContent } from '@tiptap/core'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  ChevronDown,
  Highlighter,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  PaintBucket,
  PaintRoller,
  Pilcrow,
  Plus,
  Printer,
  Redo2,
  Underline,
  Undo2,
} from 'lucide-react'
import { createEditorExtensions } from './editor/extensions'
import type { TagSuggestionItem } from './editor/tagSuggestion'
import {
  createNote,
  extractNotePreview,
  findTagResults,
  formatNoteDate,
  getTagSummaries,
  type Note,
} from './lib/notes'
import {
  ensureSupabaseUser,
  fetchCloudNotes,
  subscribeToCloudNotes,
  syncCloudNotes,
} from './lib/supabase'
import { normalizeTag } from './lib/tags'
import './App.css'

type PendingTagFocus = {
  noteId: string
  tagId: string
  occurrenceIndex: number
}

type PageView = 'editor' | 'notes' | 'tags'
type SaveState = 'saved' | 'saving' | 'error' | 'sync'

const FONT_FAMILIES = [
  { label: 'Aptos Sans', value: 'Aptos, Manrope, sans-serif' },
  { label: 'Manrope', value: 'Manrope, sans-serif' },
  { label: 'Newsreader', value: '"Newsreader", serif' },
  { label: 'IBM Plex Sans', value: '"IBM Plex Sans", sans-serif' },
  { label: 'Source Serif 4', value: '"Source Serif 4", serif' },
]

const FONT_SIZES = ['12px', '14px', '15px', '16px', '18px', '20px', '24px', '30px']
const LINE_HEIGHTS = [
  { label: 'Single', value: '1.15' },
  { label: 'Comfort', value: '1.5' },
  { label: 'Relaxed', value: '1.75' },
  { label: 'Spacious', value: '2' },
]

const TEXT_COLORS = ['#1f2328', '#5f6368', '#0b57d0', '#196c2e', '#b3261e', '#7c4dff']
const HIGHLIGHT_COLORS = ['#fff59d', '#ffd9a8', '#b9f6ca', '#d7efff', '#f0d9ff', '#ffd6e7']
const PARAGRAPH_STYLES = [{ label: 'Normal text', value: 'paragraph' }]

function App() {
  const [notes, setNotes] = useState<Note[]>([])
  const [activeNoteId, setActiveNoteId] = useState('')
  const [currentPage, setCurrentPage] = useState<PageView>('editor')
  const [tagSearch, setTagSearch] = useState('')
  const [selectedTagId, setSelectedTagId] = useState('')
  const [pendingTagFocus, setPendingTagFocus] = useState<PendingTagFocus | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('sync')
  const [saveMessage, setSaveMessage] = useState('Connecting to Supabase…')
  const [cloudUserId, setCloudUserId] = useState('')
  const [isCloudReady, setIsCloudReady] = useState(false)
  const notesRef = useRef(notes)
  const hasPendingSaveRef = useRef(false)
  const cloudSyncTimeoutRef = useRef<number | null>(null)
  const skipNextCloudSyncRef = useRef(false)

  useEffect(() => {
    notesRef.current = notes
  }, [notes])

  useEffect(() => {
    let isCancelled = false

    async function initializeCloudSync() {
      setSaveState('sync')
      setSaveMessage('Connecting to Supabase…')

      const authResult = await ensureSupabaseUser()

      if (isCancelled) {
        return
      }

      if (!authResult.ok) {
        setSaveState('error')
        setSaveMessage(`Supabase unavailable: ${authResult.error}`)
        return
      }

      const userId = authResult.data.id
      setCloudUserId(userId)

      const remoteResult = await fetchCloudNotes(userId)

      if (isCancelled) {
        return
      }

      if (!remoteResult.ok) {
        setSaveState('error')
        setSaveMessage(`Supabase load failed: ${remoteResult.error}`)
        return
      }

      const remoteNotes = remoteResult.data

      if (!remoteNotes.length) {
        const firstNote = createNote()
        const createResult = await syncCloudNotes(userId, [firstNote])

        if (isCancelled) {
          return
        }

        if (!createResult.ok) {
          setSaveState('error')
          setSaveMessage(`Supabase sync failed: ${createResult.error}`)
          return
        }

        skipNextCloudSyncRef.current = true
        setNotes([firstNote])
        setActiveNoteId(firstNote.id)
        setSaveState('saved')
        setSaveMessage('All changes synced to Supabase.')
        setIsCloudReady(true)
        return
      }

      skipNextCloudSyncRef.current = true
      setNotes(remoteNotes)
      setActiveNoteId(remoteNotes[0]?.id ?? '')
      setSaveState('saved')
      setSaveMessage('All changes synced to Supabase.')
      setIsCloudReady(true)
    }

    void initializeCloudSync()

    return () => {
      isCancelled = true
    }
  }, [])

  useEffect(() => {
    if (!cloudUserId) {
      return
    }

    return subscribeToCloudNotes(cloudUserId, async () => {
      if (hasPendingSaveRef.current) {
        return
      }

      const remoteResult = await fetchCloudNotes(cloudUserId)

      if (!remoteResult.ok) {
        setSaveState('error')
        setSaveMessage(`Supabase sync failed: ${remoteResult.error}`)
        return
      }

      skipNextCloudSyncRef.current = true
      setNotes(remoteResult.data.length ? remoteResult.data : [])
      setActiveNoteId((currentActiveId) =>
        remoteResult.data.some((note) => note.id === currentActiveId)
          ? currentActiveId
          : remoteResult.data[0]?.id ?? '',
      )
      setSaveState('saved')
      setSaveMessage('All changes synced to Supabase.')
    })
  }, [cloudUserId])

  useEffect(() => {
    if (!cloudUserId) {
      return
    }

    if (skipNextCloudSyncRef.current) {
      skipNextCloudSyncRef.current = false
      return
    }

    if (!notes.length) {
      return
    }

    hasPendingSaveRef.current = true

    if (cloudSyncTimeoutRef.current) {
      window.clearTimeout(cloudSyncTimeoutRef.current)
    }

    cloudSyncTimeoutRef.current = window.setTimeout(async () => {
      const syncResult = await syncCloudNotes(cloudUserId, notesRef.current)
      hasPendingSaveRef.current = false

      if (syncResult.ok) {
        setSaveState('saved')
        setSaveMessage('All changes synced to Supabase.')
      } else {
        setSaveState('error')
        setSaveMessage(`Supabase sync failed: ${syncResult.error}`)
      }
    }, 900)

    return () => {
      if (cloudSyncTimeoutRef.current) {
        window.clearTimeout(cloudSyncTimeoutRef.current)
      }
    }
  }, [cloudUserId, notes])

  const activeNote = notes.find((note) => note.id === activeNoteId) ?? notes[0]
  const tagSummaries = getTagSummaries(notes)
  const tagSuggestionItems: TagSuggestionItem[] = tagSummaries.map((tag) => ({
    id: tag.id,
    label: tag.label,
  }))
  const effectiveSelectedTagId = tagSummaries.some((tag) => tag.id === selectedTagId)
    ? selectedTagId
    : ''
  const normalizedSearch = normalizeTag(tagSearch)
  const searchTerm = tagSearch.trim().replace(/^#+/, '').toLowerCase()
  const visibleTags = tagSummaries
    .filter((tag) => {
      if (!normalizedSearch) {
        return true
      }

      return tag.id.includes(normalizedSearch) || tag.label.toLowerCase().includes(searchTerm)
    })
    .sort((left, right) => {
      if (!normalizedSearch) {
        return left.label.localeCompare(right.label)
      }

      const leftLabel = left.label.toLowerCase()
      const rightLabel = right.label.toLowerCase()
      const leftStarts = left.id.startsWith(normalizedSearch) || leftLabel.startsWith(searchTerm)
      const rightStarts =
        right.id.startsWith(normalizedSearch) || rightLabel.startsWith(searchTerm)

      if (leftStarts !== rightStarts) {
        return leftStarts ? -1 : 1
      }

      return left.label.localeCompare(right.label)
    })
  const tagSearchSuggestions = visibleTags.slice(0, 8)
  const activeTagId = effectiveSelectedTagId || tagSearchSuggestions[0]?.id || ''
  const activeTagResults = activeTagId ? findTagResults(notes, activeTagId) : []
  const activeTagLabel = tagSummaries.find((tag) => tag.id === activeTagId)?.label ?? activeTagId

  const hasNoTagMatches = Boolean(normalizedSearch) && !tagSearchSuggestions.length
  const shouldShowSuggestionList = Boolean(normalizedSearch)

  function updateCurrentNote(patch: Partial<Pick<Note, 'title' | 'content'>>) {
    setSaveState('saving')
    setSaveMessage('Syncing to Supabase…')
    setNotes((currentNotes) =>
      currentNotes.map((note) =>
        note.id === activeNoteId
          ? {
              ...note,
              ...patch,
              updatedAt: new Date().toISOString(),
            }
          : note,
      ),
    )
  }

  function handleCreateNote() {
    const newNote = createNote()
    setSaveState('saving')
    setSaveMessage('Syncing to Supabase…')
    setNotes((currentNotes) => [newNote, ...currentNotes])
    setActiveNoteId(newNote.id)
    setPendingTagFocus(null)
    setCurrentPage('editor')
  }

  function handleDeleteNote(noteId: string) {
    if (notes.length === 1) {
      const freshNote = createNote()
      setSaveState('saving')
      setSaveMessage('Syncing to Supabase…')
      setNotes([freshNote])
      setActiveNoteId(freshNote.id)
      setPendingTagFocus(null)
      return
    }

    setSaveState('saving')
    setSaveMessage('Syncing to Supabase…')
    setNotes((currentNotes) => currentNotes.filter((note) => note.id !== noteId))

    if (activeNoteId === noteId) {
      const fallback = notes.find((note) => note.id !== noteId)
      if (fallback) {
        setActiveNoteId(fallback.id)
      }
    }
  }

  function handleTagSelection(tagId: string, tagLabel?: string) {
    setSelectedTagId(tagId)
    setTagSearch(tagLabel ?? tagSummaries.find((tag) => tag.id === tagId)?.label ?? tagId)
  }

  function handleSearchSubmit() {
    if (tagSearchSuggestions[0]) {
      handleTagSelection(tagSearchSuggestions[0].id, tagSearchSuggestions[0].label)
    }
  }

  function openNoteInEditor(noteId: string) {
    setActiveNoteId(noteId)
    setPendingTagFocus(null)
    setCurrentPage('editor')
  }

  if (!isCloudReady || !activeNote) {
    return (
      <div className="app-shell">
        <main className="workspace">
          <div className="docs-chrome">
            <nav className="workspace-nav" aria-label="Section navigation">
              <button className="workspace-nav-link active" type="button">
                <span>Editor</span>
              </button>
              <button className="workspace-nav-link" type="button">
                <span>Notes</span>
              </button>
              <button className="workspace-nav-link" type="button">
                <span>Tag Search</span>
              </button>
              <span className={`workspace-save-state ${saveState}`}>{saveMessage}</span>
            </nav>

            <section className="workspace-page">
              <div className="page-shell">
                <section className="sidebar-panel page-panel">
                  <div className="panel-heading">
                    <h2>Supabase</h2>
                  </div>
                  <p>{saveMessage}</p>
                </section>
              </div>
            </section>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <main className="workspace">
        <div className="docs-chrome">
          <nav className="workspace-nav" aria-label="Section navigation">
            <button
              className={`workspace-nav-link${currentPage === 'editor' ? ' active' : ''}`}
              onClick={() => setCurrentPage('editor')}
              type="button"
            >
              <span>Editor</span>
            </button>
            <button
              className={`workspace-nav-link${currentPage === 'notes' ? ' active' : ''}`}
              onClick={() => setCurrentPage('notes')}
              type="button"
            >
              <span>Notes</span>
            </button>
            <button
              className={`workspace-nav-link${currentPage === 'tags' ? ' active' : ''}`}
              onClick={() => setCurrentPage('tags')}
              type="button"
            >
              <span>Tag Search</span>
            </button>
            <span className={`workspace-save-state ${saveState}`}>{saveMessage}</span>
          </nav>

          {currentPage === 'editor' ? (
            <EditorPanel
              note={activeNote}
              onContentChange={(content) => updateCurrentNote({ content })}
              onFocusHandled={() => setPendingTagFocus(null)}
              onTitleChange={(title) => updateCurrentNote({ title })}
              pendingTagFocus={pendingTagFocus}
              tagSuggestions={tagSuggestionItems}
            />
          ) : null}

          {currentPage === 'notes' ? (
            <section className="workspace-page">
              <div className="page-shell">
                <section className="sidebar-panel page-panel">
                  <div className="panel-heading">
                    <h2>Notes</h2>
                    <div className="panel-heading-actions">
                      <span>{notes.length}</span>
                      <button className="primary-button" onClick={handleCreateNote} type="button">
                        New note
                      </button>
                    </div>
                  </div>
                  <div className="note-list">
                    {notes.map((note) => {
                      const isActive = note.id === activeNoteId

                      return (
                        <article
                          key={note.id}
                          className={`note-card${isActive ? ' active' : ''}`}
                          onClick={() => openNoteInEditor(note.id)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              openNoteInEditor(note.id)
                            }
                          }}
                          role="button"
                          tabIndex={0}
                        >
                          <div className="note-card-row">
                            <strong>{note.title || 'Untitled note'}</strong>
                            <button
                              className="ghost-button note-delete"
                              onClick={(event) => {
                                event.stopPropagation()
                                handleDeleteNote(note.id)
                              }}
                              type="button"
                            >
                              Delete
                            </button>
                          </div>
                          <p>{extractNotePreview(note.content)}</p>
                          <span>{formatNoteDate(note.updatedAt)}</span>
                        </article>
                      )
                    })}
                  </div>
                </section>
              </div>
            </section>
          ) : null}

          {currentPage === 'tags' ? (
            <section className="workspace-page">
              <div className="page-shell">
                <section className="sidebar-panel page-panel">
                  <div className="panel-heading">
                    <h2>Tag Search</h2>
                    <span>{tagSummaries.length}</span>
                  </div>
                  <label className="search-input">
                    <span>#</span>
                    <input
                      onChange={(event) => {
                        setTagSearch(event.target.value)
                        setSelectedTagId('')
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          handleSearchSubmit()
                        }
                      }}
                      placeholder="Search saved tags"
                      type="text"
                      value={tagSearch}
                    />
                  </label>

                  {shouldShowSuggestionList && tagSearchSuggestions.length ? (
                    <div className="search-suggestion-list" role="listbox" aria-label="Tag suggestions">
                      {tagSearchSuggestions.map((tag) => (
                        <button
                          key={tag.id}
                          className={`search-suggestion-item${activeTagId === tag.id ? ' active' : ''}`}
                          onClick={() => {
                            handleTagSelection(tag.id, tag.label)
                          }}
                          type="button"
                        >
                          <strong>#{tag.label}</strong>
                          <span>{tag.count} matches</span>
                        </button>
                      ))}
                    </div>
                  ) : null}

                  {hasNoTagMatches ? (
                    <div className="search-empty-state">No saved tags match this search.</div>
                  ) : null}

                  <div className="tag-list">
                    {visibleTags.slice(0, 18).map((tag) => (
                      <button
                        key={tag.id}
                        className={`tag-row${activeTagId === tag.id ? ' active' : ''}`}
                        onClick={() => handleTagSelection(tag.id, tag.label)}
                        type="button"
                      >
                        <span>#{tag.label}</span>
                        <small>{tag.count}</small>
                      </button>
                    ))}
                  </div>

                  {activeTagId ? (
                    <div className="tag-results">
                      <div className="tag-results-header">
                        <strong>#{activeTagLabel}</strong>
                        <span>{activeTagResults.length}</span>
                      </div>
                      {activeTagResults.map((result) => (
                        <button
                          key={`${result.noteId}-${result.tagId}-${result.occurrenceIndex}`}
                          className="result-card"
                          onClick={() => {
                            setActiveNoteId(result.noteId)
                            setPendingTagFocus({
                              noteId: result.noteId,
                              tagId: result.tagId,
                              occurrenceIndex: result.occurrenceIndex,
                            })
                            setCurrentPage('editor')
                          }}
                          type="button"
                        >
                          <strong>{result.noteTitle}</strong>
                          <p>{result.snippet}</p>
                          <span>{formatNoteDate(result.updatedAt)}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </section>
              </div>
            </section>
          ) : null}
        </div>
      </main>
    </div>
  )
}

type EditorPanelProps = {
  note: Note
  onContentChange: (content: JSONContent) => void
  onTitleChange: (title: string) => void
  pendingTagFocus: PendingTagFocus | null
  onFocusHandled: () => void
  tagSuggestions: TagSuggestionItem[]
}

function EditorPanel({
  note,
  onContentChange,
  onTitleChange,
  pendingTagFocus,
  onFocusHandled,
  tagSuggestions,
}: EditorPanelProps) {
  const activeNoteRef = useRef(note.id)
  const [tagSuggestionStore] = useState(() => ({
    items: tagSuggestions,
    getItems() {
      return this.items
    },
    setItems(nextItems: TagSuggestionItem[]) {
      this.items = nextItems
    },
  }))
  const [extensions] = useState(() =>
    createEditorExtensions(() => tagSuggestionStore.getItems()),
  )

  useEffect(() => {
    tagSuggestionStore.setItems(tagSuggestions)
  }, [tagSuggestionStore, tagSuggestions])

  const editor = useEditor({
    extensions,
    content: note.content,
    editorProps: {
      attributes: {
        class: 'note-editor',
      },
    },
    immediatelyRender: true,
  })

  useEffect(() => {
    if (!editor) {
      return
    }

    const handleUpdate = () => {
      onContentChange(editor.getJSON())
    }

    editor.on('update', handleUpdate)

    return () => {
      editor.off('update', handleUpdate)
    }
  }, [editor, onContentChange])

  useEffect(() => {
    if (!editor) {
      return
    }

    if (activeNoteRef.current === note.id) {
      return
    }

    editor.commands.setContent(note.content, { emitUpdate: false })
    editor.commands.focus('end')
    activeNoteRef.current = note.id
  }, [editor, note.content, note.id])

  useEffect(() => {
    if (!editor || !pendingTagFocus || pendingTagFocus.noteId !== note.id) {
      return
    }

    let currentOccurrence = 0
    let selection: { from: number; to: number } | null = null

    editor.state.doc.descendants((node, position) => {
      if (node.type.name === 'tag' && node.attrs.id === pendingTagFocus.tagId) {
        currentOccurrence += 1

        if (currentOccurrence === pendingTagFocus.occurrenceIndex) {
          selection = { from: position, to: position + node.nodeSize }
          return false
        }
      }

      return true
    })

    if (selection) {
      editor.chain().focus().setTextSelection(selection).run()
    }

    onFocusHandled()
  }, [editor, note.id, onFocusHandled, pendingTagFocus])

  const editorState = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => {
      if (!currentEditor) {
        return {
          canUndo: false,
          canRedo: false,
          isBold: false,
          isItalic: false,
          isUnderline: false,
          isBullet: false,
          isOrdered: false,
          isChecklist: false,
          alignment: 'left',
          color: TEXT_COLORS[0],
          highlight: HIGHLIGHT_COLORS[0],
          fontFamily: FONT_FAMILIES[0].value,
          fontSize: '15px',
          lineHeight: '1.5',
        }
      }

      const textStyle = currentEditor.getAttributes('textStyle')
      const paragraph = currentEditor.getAttributes('paragraph')
      const heading = currentEditor.getAttributes('heading')
      const highlight = currentEditor.getAttributes('highlight')

      return {
        canUndo: currentEditor.can().undo(),
        canRedo: currentEditor.can().redo(),
        isBold: currentEditor.isActive('bold'),
        isItalic: currentEditor.isActive('italic'),
        isUnderline: currentEditor.isActive('underline'),
        isBullet: currentEditor.isActive('bulletList'),
        isOrdered: currentEditor.isActive('orderedList'),
        isChecklist: currentEditor.isActive('taskList'),
        alignment: paragraph.textAlign ?? heading.textAlign ?? 'left',
        color: textStyle.color ?? TEXT_COLORS[0],
        highlight: highlight.color ?? HIGHLIGHT_COLORS[0],
        fontFamily: textStyle.fontFamily ?? FONT_FAMILIES[0].value,
        fontSize: textStyle.fontSize ?? '15px',
        lineHeight: paragraph.lineHeight ?? heading.lineHeight ?? '1.5',
      }
    },
  })

  return (
    <section className="editor-panel">
      <div className="docs-toolbar-bar">
        <div className="toolbar-main">
          <div className="toolbar-group">
            <button
              aria-label="Undo"
              className="icon-button icon-only"
              disabled={!editorState?.canUndo}
              onClick={() => editor?.chain().focus().undo().run()}
              type="button"
            >
              <Undo2 size={18} />
            </button>
            <button
              aria-label="Redo"
              className="icon-button icon-only"
              disabled={!editorState?.canRedo}
              onClick={() => editor?.chain().focus().redo().run()}
              type="button"
            >
              <Redo2 size={18} />
            </button>
            <button aria-label="Print" className="icon-button icon-only" type="button">
              <Printer size={18} />
            </button>
            <button aria-label="Paint format" className="icon-button icon-only" type="button">
              <PaintRoller size={18} />
            </button>
          </div>

          <div className="toolbar-group">
            <button className="toolbar-pill" type="button">
              100%
              <ChevronDown size={16} />
            </button>
            <select className="toolbar-select compact-select" defaultValue="paragraph">
              {PARAGRAPH_STYLES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
            <select
              className="toolbar-select"
              onChange={(event) =>
                editor?.chain().focus().setFontFamily(event.target.value).run()
              }
              value={editorState?.fontFamily}
            >
              {FONT_FAMILIES.map((font) => (
                <option key={font.value} value={font.value}>
                  {font.label}
                </option>
              ))}
            </select>
            <div className="font-size-stepper">
              <button
                aria-label="Decrease font size"
                className="icon-button icon-only"
                onClick={() => {
                  if (!editorState?.fontSize) {
                    return
                  }

                  const currentIndex = FONT_SIZES.indexOf(editorState.fontSize)
                  const safeIndex = currentIndex === -1 ? 0 : currentIndex
                  const nextIndex = Math.max(0, safeIndex - 1)
                  editor?.chain().focus().setFontSize(FONT_SIZES[nextIndex]).run()
                }}
                type="button"
              >
                <Minus size={16} />
              </button>
              <select
                className="toolbar-select size-select"
                onChange={(event) =>
                  editor?.chain().focus().setFontSize(event.target.value).run()
                }
                value={editorState?.fontSize}
              >
                {FONT_SIZES.map((fontSize) => (
                  <option key={fontSize} value={fontSize}>
                    {fontSize.replace('px', '')}
                  </option>
                ))}
              </select>
              <button
                aria-label="Increase font size"
                className="icon-button icon-only"
                onClick={() => {
                  if (!editorState?.fontSize) {
                    return
                  }

                  const currentIndex = FONT_SIZES.indexOf(editorState.fontSize)
                  const safeIndex = currentIndex === -1 ? 0 : currentIndex
                  const nextIndex = Math.min(FONT_SIZES.length - 1, safeIndex + 1)
                  editor?.chain().focus().setFontSize(FONT_SIZES[nextIndex]).run()
                }}
                type="button"
              >
                <Plus size={16} />
              </button>
            </div>
          </div>

          <div className="toolbar-group">
            <button
              aria-label="Bold"
              className={`icon-button icon-only${editorState?.isBold ? ' active' : ''}`}
              onClick={() => editor?.chain().focus().toggleBold().run()}
              type="button"
            >
              <Bold size={18} />
            </button>
            <button
              aria-label="Italic"
              className={`icon-button icon-only${editorState?.isItalic ? ' active' : ''}`}
              onClick={() => editor?.chain().focus().toggleItalic().run()}
              type="button"
            >
              <Italic size={18} />
            </button>
            <button
              aria-label="Underline"
              className={`icon-button icon-only${editorState?.isUnderline ? ' active' : ''}`}
              onClick={() => editor?.chain().focus().toggleUnderline().run()}
              type="button"
            >
              <Underline size={18} />
            </button>
          </div>

          <div className="toolbar-group color-group">
            <label className="color-field">
              <span>
                <PaintBucket size={17} />
              </span>
              <input
                onChange={(event) =>
                  editor?.chain().focus().setColor(event.target.value).run()
                }
                type="color"
                value={editorState?.color}
              />
            </label>
            <label className="color-field">
              <span>
                <Highlighter size={17} />
              </span>
              <input
                onChange={(event) =>
                  editor?.chain().focus().setHighlight({ color: event.target.value }).run()
                }
                type="color"
                value={editorState?.highlight}
              />
            </label>
          </div>

          <div className="toolbar-group">
            {['left', 'center', 'right', 'justify'].map((alignment) => (
              <button
                key={alignment}
                aria-label={`Align ${alignment}`}
                className={`icon-button icon-only${editorState?.alignment === alignment ? ' active' : ''}`}
                onClick={() => editor?.chain().focus().setTextAlign(alignment).run()}
                type="button"
              >
                {alignment === 'left' ? <AlignLeft size={18} /> : null}
                {alignment === 'center' ? <AlignCenter size={18} /> : null}
                {alignment === 'right' ? <AlignRight size={18} /> : null}
                {alignment === 'justify' ? <AlignJustify size={18} /> : null}
              </button>
            ))}
          </div>

          <div className="toolbar-group">
            <select
              className="toolbar-select compact-select"
              onChange={(event) =>
                editor?.chain().focus().setLineHeight(event.target.value).run()
              }
              value={editorState?.lineHeight}
            >
              {LINE_HEIGHTS.map((lineHeight) => (
                <option key={lineHeight.value} value={lineHeight.value}>
                  {lineHeight.label}
                </option>
              ))}
            </select>
          </div>

          <div className="toolbar-group">
            <button
              aria-label="Bulleted list"
              className={`icon-button icon-only${editorState?.isBullet ? ' active' : ''}`}
              onClick={() => editor?.chain().focus().toggleBulletList().run()}
              type="button"
            >
              <List size={18} />
            </button>
            <button
              aria-label="Numbered list"
              className={`icon-button icon-only${editorState?.isOrdered ? ' active' : ''}`}
              onClick={() => editor?.chain().focus().toggleOrderedList().run()}
              type="button"
            >
              <ListOrdered size={18} />
            </button>
            <button
              aria-label="Checklist"
              className={`icon-button icon-only${editorState?.isChecklist ? ' active' : ''}`}
              onClick={() => editor?.chain().focus().toggleTaskList().run()}
              type="button"
            >
              <ListChecks size={18} />
            </button>
          </div>

          <div className="toolbar-group">
            <button aria-label="Link" className="icon-button icon-only" type="button">
              <Link2 size={18} />
            </button>
            <button aria-label="Insert image" className="icon-button icon-only" type="button">
              <ImagePlus size={18} />
            </button>
            <button
              aria-label="Clear formatting"
              className="icon-button icon-only"
              onClick={() =>
                editor?.chain().focus().unsetAllMarks().clearNodes().unsetTextAlign().run()
              }
              type="button"
            >
              <Pilcrow size={18} />
            </button>
          </div>
        </div>
      </div>
      <section className="editor-surface">
        <div className="document-stage">
          <article className="document-page">
            <input
              className="note-title-input"
              onChange={(event) => onTitleChange(event.target.value)}
              placeholder="Untitled note"
              type="text"
              value={note.title}
            />
            <EditorContent editor={editor} />
          </article>
        </div>
      </section>
    </section>
  )
}

export default App
