import type { JSONContent } from '@tiptap/core'
import { normalizeTag } from './tags'

export type Note = {
  id: string
  title: string
  content: JSONContent
  createdAt: string
  updatedAt: string
}

export type SaveNotesResult = {
  ok: boolean
  error?: string
}

type TagSummary = {
  id: string
  label: string
  count: number
}

type TagResult = {
  noteId: string
  noteTitle: string
  tagId: string
  tagLabel: string
  snippet: string
  updatedAt: string
  occurrenceIndex: number
}

export const STORAGE_KEY = 'quiet-notes::notes'

const EMPTY_DOCUMENT: JSONContent = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
}

function cloneEmptyDocument() {
  return {
    type: 'doc',
    content: [{ type: 'paragraph' }],
  } as JSONContent
}

export function createNote(): Note {
  const now = new Date().toISOString()

  return {
    id: crypto.randomUUID(),
    title: 'Untitled note',
    content: cloneEmptyDocument(),
    createdAt: now,
    updatedAt: now,
  }
}

function normalizeNote(note: Partial<Note>): Note {
  const now = new Date().toISOString()

  return {
    id: typeof note.id === 'string' && note.id ? note.id : crypto.randomUUID(),
    title: typeof note.title === 'string' && note.title.trim() ? note.title : 'Untitled note',
    content: note.content ?? EMPTY_DOCUMENT,
    createdAt: typeof note.createdAt === 'string' ? note.createdAt : now,
    updatedAt: typeof note.updatedAt === 'string' ? note.updatedAt : now,
  }
}

export function parseStoredNotes(raw: string | null): Note[] | null {
  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as Partial<Note>[]

    if (!Array.isArray(parsed) || !parsed.length) {
      return null
    }

    return parsed.map(normalizeNote)
  } catch {
    return null
  }
}

export function loadNotes(): Note[] {
  const fallback = [createNote()]

  try {
    const parsed = parseStoredNotes(window.localStorage.getItem(STORAGE_KEY))

    if (!parsed) {
      return fallback
    }

    return parsed
  } catch {
    return fallback
  }
}

export function saveNotes(notes: Note[]): SaveNotesResult {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(notes))
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unable to save notes locally.',
    }
  }
}

type FlatMention = {
  id: string
  label: string
  start: number
  end: number
}

function flattenNode(node?: JSONContent): { text: string; mentions: FlatMention[] } {
  if (!node) {
    return { text: '', mentions: [] }
  }

  if (node.type === 'text') {
    return { text: node.text ?? '', mentions: [] }
  }

  if (node.type === 'hardBreak') {
    return { text: ' ', mentions: [] }
  }

  if (node.type === 'tag') {
    const label = node.attrs?.label ?? node.attrs?.id ?? ''
    const tagText = `#${label}`

    return {
      text: tagText,
      mentions: [
        {
          id: normalizeTag(node.attrs?.id ?? label),
          label,
          start: 0,
          end: tagText.length,
        },
      ],
    }
  }

  let text = ''
  const mentions: FlatMention[] = []

  for (const child of node.content ?? []) {
    const flattenedChild = flattenNode(child)
    const offset = text.length
    text += flattenedChild.text
    flattenedChild.mentions.forEach((mention) => {
      mentions.push({
        ...mention,
        start: mention.start + offset,
        end: mention.end + offset,
      })
    })
  }

  return { text, mentions }
}

function collectBlocks(node?: JSONContent, blocks: Array<{ text: string; mentions: FlatMention[] }> = []) {
  if (!node) {
    return blocks
  }

  const blockTypes = new Set(['paragraph', 'listItem', 'taskItem'])

  if (node.type && blockTypes.has(node.type)) {
    const flattened = flattenNode(node)
    if (flattened.text.trim() || flattened.mentions.length) {
      blocks.push(flattened)
    }
    return blocks
  }

  for (const child of node.content ?? []) {
    collectBlocks(child, blocks)
  }

  return blocks
}

function createSnippet(text: string, start: number, end: number) {
  const snippetStart = Math.max(0, start - 36)
  const snippetEnd = Math.min(text.length, end + 56)
  const compact = text.slice(snippetStart, snippetEnd).replace(/\s+/g, ' ').trim()

  return `${snippetStart > 0 ? '…' : ''}${compact}${snippetEnd < text.length ? '…' : ''}`
}

export function extractNotePreview(content: JSONContent) {
  const preview = collectBlocks(content)
    .map((block) => block.text.trim())
    .find(Boolean)

  if (!preview) {
    return 'Start writing…'
  }

  return preview.length > 88 ? `${preview.slice(0, 88)}…` : preview
}

export function getTagSummaries(notes: Note[]): TagSummary[] {
  const tagMap = new Map<string, TagSummary>()

  notes.forEach((note) => {
    const blocks = collectBlocks(note.content)

    blocks.forEach((block) => {
      block.mentions.forEach((mention) => {
        const existing = tagMap.get(mention.id)
        if (existing) {
          existing.count += 1
          return
        }

        tagMap.set(mention.id, {
          id: mention.id,
          label: mention.label,
          count: 1,
        })
      })
    })
  })

  return [...tagMap.values()].sort((left, right) => left.label.localeCompare(right.label))
}

export function findTagResults(notes: Note[], tagId: string): TagResult[] {
  return notes
    .flatMap((note) => {
      const blocks = collectBlocks(note.content)
      const occurrenceCounter = new Map<string, number>()

      return blocks.flatMap((block) =>
        block.mentions.flatMap((mention) => {
          const nextOccurrence = (occurrenceCounter.get(mention.id) ?? 0) + 1
          occurrenceCounter.set(mention.id, nextOccurrence)

          if (mention.id !== tagId) {
            return []
          }

          return [
            {
              noteId: note.id,
              noteTitle: note.title || 'Untitled note',
              tagId: mention.id,
              tagLabel: mention.label,
              snippet: createSnippet(block.text, mention.start, mention.end),
              updatedAt: note.updatedAt,
              occurrenceIndex: nextOccurrence,
            },
          ]
        }),
      )
    })
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

export function formatNoteDate(dateString: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(dateString))
}
