import { createClient } from '@supabase/supabase-js'
import type { RealtimeChannel, User } from '@supabase/supabase-js'
import type { Note } from './notes'

const SUPABASE_URL = 'https://jrczanyuirjdfsqvuzyq.supabase.co'
const SUPABASE_PUBLISHABLE_KEY =
  'sb_publishable_mlNQw5yb2Ir6joRPPqbwWA_TGMZ57UP'

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    storageKey: 'quiet-notes::supabase-auth',
  },
})

export type CloudResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string }

const ANONYMOUS_AUTH_DISABLED_MESSAGE =
  'Anonymous sign-ins are disabled in this Supabase project. Enable them in Supabase Dashboard > Authentication > Sign In / Providers > Anonymous.'

type NoteRecord = {
  id: string
  user_id: string
  title: string
  content: Note['content']
  created_at: string
  updated_at: string
}

function mapRecordToNote(record: NoteRecord): Note {
  return {
    id: record.id,
    title: record.title,
    content: record.content,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  }
}

function mapNoteToRecord(note: Note, userId: string): NoteRecord {
  return {
    id: note.id,
    user_id: userId,
    title: note.title,
    content: note.content,
    created_at: note.createdAt,
    updated_at: note.updatedAt,
  }
}

export async function ensureSupabaseUser(): Promise<CloudResult<User>> {
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession()

  if (sessionError) {
    return { ok: false, error: sessionError.message }
  }

  if (session?.user) {
    return { ok: true, data: session.user }
  }

  const { data, error } = await supabase.auth.signInAnonymously()

  if (error || !data.user) {
    const message = error?.message ?? ''

    return {
      ok: false,
      error:
        message.includes('Anonymous sign-ins are disabled')
          ? ANONYMOUS_AUTH_DISABLED_MESSAGE
          : message || ANONYMOUS_AUTH_DISABLED_MESSAGE,
    }
  }

  return { ok: true, data: data.user }
}

export async function fetchCloudNotes(userId: string): Promise<CloudResult<Note[]>> {
  const { data, error } = await supabase
    .from('notes')
    .select('id, user_id, title, content, created_at, updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })

  if (error) {
    return { ok: false, error: error.message }
  }

  return {
    ok: true,
    data: (data as NoteRecord[]).map(mapRecordToNote),
  }
}

export async function syncCloudNotes(
  userId: string,
  notes: Note[],
): Promise<CloudResult<null>> {
  const payload = notes.map((note) => mapNoteToRecord(note, userId))

  const { error: upsertError } = await supabase
    .from('notes')
    .upsert(payload, { onConflict: 'id' })

  if (upsertError) {
    return { ok: false, error: upsertError.message }
  }

  const { data: existingRows, error: existingError } = await supabase
    .from('notes')
    .select('id')
    .eq('user_id', userId)

  if (existingError) {
    return { ok: false, error: existingError.message }
  }

  const localIds = new Set(notes.map((note) => note.id))
  const idsToDelete = (existingRows ?? [])
    .map((row) => row.id as string)
    .filter((id) => !localIds.has(id))

  if (idsToDelete.length) {
    const { error: deleteError } = await supabase
      .from('notes')
      .delete()
      .eq('user_id', userId)
      .in('id', idsToDelete)

    if (deleteError) {
      return { ok: false, error: deleteError.message }
    }
  }

  return { ok: true, data: null }
}

export function subscribeToCloudNotes(
  userId: string,
  onChange: () => void,
): () => void {
  const channel: RealtimeChannel = supabase
    .channel(`notes-sync-${userId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'notes',
        filter: `user_id=eq.${userId}`,
      },
      () => onChange(),
    )
    .subscribe()

  return () => {
    void supabase.removeChannel(channel)
  }
}
