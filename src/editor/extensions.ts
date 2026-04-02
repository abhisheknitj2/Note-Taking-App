import { Extension } from '@tiptap/core'
import Color from '@tiptap/extension-color'
import FontFamily from '@tiptap/extension-font-family'
import Highlight from '@tiptap/extension-highlight'
import Mention from '@tiptap/extension-mention'
import Placeholder from '@tiptap/extension-placeholder'
import TaskItem from '@tiptap/extension-task-item'
import TaskList from '@tiptap/extension-task-list'
import TextAlign from '@tiptap/extension-text-align'
import { TextStyle } from '@tiptap/extension-text-style'
import Underline from '@tiptap/extension-underline'
import StarterKit from '@tiptap/starter-kit'
import {
  createTagSuggestionRenderer,
  type TagSuggestionItem,
} from './tagSuggestion'
import { normalizeTag } from '../lib/tags'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    fontSize: {
      setFontSize: (fontSize: string) => ReturnType
      unsetFontSize: () => ReturnType
    }
    lineHeight: {
      setLineHeight: (lineHeight: string) => ReturnType
      unsetLineHeight: () => ReturnType
    }
  }
}

const FontSize = Extension.create({
  name: 'fontSize',

  addGlobalAttributes() {
    return [
      {
        types: ['textStyle'],
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element) => element.style.fontSize || null,
            renderHTML: (attributes) => {
              if (!attributes.fontSize) {
                return {}
              }

              return { style: `font-size: ${attributes.fontSize}` }
            },
          },
        },
      },
    ]
  },

  addCommands() {
    return {
      setFontSize:
        (fontSize) =>
        ({ chain }) =>
          chain().setMark('textStyle', { fontSize }).run(),
      unsetFontSize:
        () =>
        ({ chain }) =>
          chain().setMark('textStyle', { fontSize: null }).removeEmptyTextStyle().run(),
    }
  },
})

const LineHeight = Extension.create({
  name: 'lineHeight',

  addOptions() {
    return {
      types: ['paragraph'],
    }
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          lineHeight: {
            default: '1.5',
            parseHTML: (element) => element.style.lineHeight || '1.5',
            renderHTML: (attributes) => {
              if (!attributes.lineHeight) {
                return {}
              }

              return { style: `line-height: ${attributes.lineHeight}` }
            },
          },
        },
      },
    ]
  },

  addCommands() {
    return {
      setLineHeight:
        (lineHeight) =>
        ({ commands }) =>
          this.options.types.some((type: string) =>
            commands.updateAttributes(type, { lineHeight }),
          ),
      unsetLineHeight:
        () =>
        ({ commands }) =>
          this.options.types.some((type: string) =>
            commands.resetAttributes(type, 'lineHeight'),
          ),
    }
  },
})

const Tag = Mention.extend({
  name: 'tag',
}).configure({
  deleteTriggerWithBackspace: true,
  HTMLAttributes: {
    class: 'tag-token',
  },
  renderHTML({ node }) {
    return [
      'span',
      {
        class: 'tag-token',
        'data-tag-id': node.attrs.id,
      },
      `#${node.attrs.label ?? node.attrs.id}`,
    ]
  },
  renderText({ node }) {
    return `#${node.attrs.label ?? node.attrs.id}`
  },
})

export function createEditorExtensions(
  getTagItems: () => TagSuggestionItem[] = () => [],
) {
  return [
    StarterKit.configure({
      blockquote: false,
      code: false,
      codeBlock: false,
      heading: false,
      horizontalRule: false,
      underline: false,
    }),
    Underline,
    TextStyle,
    Color,
    FontFamily,
    FontSize,
    Highlight.configure({
      multicolor: true,
    }),
    TextAlign.configure({
      types: ['paragraph'],
    }),
    LineHeight,
    Placeholder.configure({
      placeholder: '',
    }),
    TaskList,
    TaskItem.configure({
      nested: false,
    }),
    Tag.configure({
      suggestion: {
        char: '#',
        items: ({ query }) => {
          const normalizedQuery = query.trim().toLowerCase()
          const catalog = getTagItems()
          const matches: TagSuggestionItem[] = catalog.filter((item) => {
            if (!normalizedQuery) {
              return true
            }

            return (
              item.id.includes(normalizedQuery) ||
              item.label.toLowerCase().includes(normalizedQuery)
            )
          })

          if (
            normalizedQuery &&
            !matches.some((item) => item.id === normalizedQuery || item.label === query.trim())
          ) {
            matches.unshift({
              id: normalizeTag(query),
              label: query.trim(),
              isNew: true,
            })
          }

          return matches.slice(0, 8)
        },
        render: createTagSuggestionRenderer,
      },
    }),
  ]
}
