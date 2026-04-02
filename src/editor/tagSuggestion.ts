import type {
  SuggestionKeyDownProps,
  SuggestionProps,
} from '@tiptap/suggestion'

export type TagSuggestionItem = {
  id: string
  label: string
  isNew?: boolean
}

function renderItems(
  root: HTMLElement,
  props: SuggestionProps<TagSuggestionItem>,
  selectedIndex: number,
) {
  root.replaceChildren()

  const list = document.createElement('div')
  list.className = 'tag-suggestion-list'

  if (!props.items.length) {
    const empty = document.createElement('div')
    empty.className = 'tag-suggestion-empty'
    empty.textContent = 'No matching tags'
    list.append(empty)
    root.append(list)
    return
  }

  props.items.forEach((item, index) => {
    const button = document.createElement('button')
    button.className = `tag-suggestion-item${index === selectedIndex ? ' active' : ''}`
    button.type = 'button'
    const label = document.createElement('span')
    label.textContent = item.isNew ? `Create #${item.label}` : `#${item.label}`

    const meta = document.createElement('small')
    meta.textContent = item.isNew ? 'New tag' : 'Saved tag'

    button.append(label, meta)

    button.addEventListener('mousedown', (event) => {
      event.preventDefault()
      props.command(item)
    })

    list.append(button)
  })

  root.append(list)
}

function updatePosition(
  root: HTMLElement,
  props: SuggestionProps<TagSuggestionItem>,
) {
  const rect = props.clientRect?.()

  if (!rect) {
    return
  }

  root.style.left = `${rect.left + window.scrollX}px`
  root.style.top = `${rect.bottom + window.scrollY + 10}px`
}

export function createTagSuggestionRenderer() {
  let root: HTMLDivElement | null = null
  let selectedIndex = 0
  let currentProps: SuggestionProps<TagSuggestionItem> | null = null

  function selectItem(index: number) {
    if (!currentProps?.items.length) {
      return
    }

    const item = currentProps.items[index]
    if (item) {
      currentProps.command(item)
    }
  }

  function render() {
    if (!root || !currentProps) {
      return
    }

    renderItems(root, currentProps, selectedIndex)
    updatePosition(root, currentProps)
  }

  return {
    onStart: (props: SuggestionProps<TagSuggestionItem>) => {
      currentProps = props
      selectedIndex = 0
      root = document.createElement('div')
      root.className = 'tag-suggestion-menu'
      document.body.append(root)
      render()
    },
    onUpdate: (props: SuggestionProps<TagSuggestionItem>) => {
      currentProps = props
      selectedIndex = 0
      render()
    },
    onKeyDown: ({ event }: SuggestionKeyDownProps) => {
      if (!currentProps?.items.length) {
        return false
      }

      if (event.key === 'ArrowDown') {
        selectedIndex = (selectedIndex + 1) % currentProps.items.length
        render()
        return true
      }

      if (event.key === 'ArrowUp') {
        selectedIndex =
          (selectedIndex + currentProps.items.length - 1) % currentProps.items.length
        render()
        return true
      }

      if (event.key === 'Enter') {
        selectItem(selectedIndex)
        return true
      }

      if (event.key === 'Escape') {
        root?.remove()
        root = null
        return true
      }

      return false
    },
    onExit: () => {
      root?.remove()
      root = null
      currentProps = null
      selectedIndex = 0
    },
  }
}
