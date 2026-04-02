export function normalizeTag(value: string) {
  return value
    .trim()
    .replace(/^#+/, '')
    .replace(/\s+/g, '-')
    .toLowerCase()
}
