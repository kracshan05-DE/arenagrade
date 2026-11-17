'use client'

import { useId, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'

// Admin photo picker for the public "images" storage bucket.
//
// The list of URLs belongs to the parent form (controlled component). Files
// are uploaded as soon as they are picked, but nothing is deleted from storage
// here: the parent calls finalizeImageChanges() when the form is saved or
// cancelled, so a cancelled edit never leaves a record pointing at a deleted
// file, and uploads from a cancelled edit do not pile up in the bucket.

const BUCKET = 'images'
const TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
const MAX_BYTES = 5 * 1024 * 1024

interface ImageUploadProps {
  folder: string
  existingImages?: string[]
  onImagesChange: (urls: string[]) => void
  maxImages?: number
  /** Show "Make cover" so the first photo can be chosen (court photos). */
  coverControl?: boolean
}

/** Object path inside the bucket for one of our public URLs, or null for anything else. */
export function storagePath(url: string) {
  const marker = `/storage/v1/object/public/${BUCKET}/`
  const i = url.indexOf(marker)
  return i === -1 ? null : decodeURIComponent(url.slice(i + marker.length))
}

/**
 * Delete files the form no longer uses.
 * - saved: the list just written to the database → removes original files that were dropped.
 * - saved = null (cancelled) → removes files uploaded during this edit and never saved.
 * Best effort: a failed delete leaves an unused file, never a broken record.
 */
export async function finalizeImageChanges(original: string[], current: string[], saved: string[] | null) {
  const keep = new Set(saved ?? original)
  const candidates = saved ? original : current
  const paths = candidates.filter((u) => !keep.has(u)).map(storagePath).filter((p): p is string => !!p)
  if (paths.length) await supabase.storage.from(BUCKET).remove(paths)
}

export default function ImageUpload({ folder, existingImages = [], onImagesChange, maxImages = 5, coverControl = false }: ImageUploadProps) {
  const inputId = useId()
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const images = existingImages

  const uploadFiles = async (files: File[]) => {
    setError('')
    const room = maxImages - images.length
    if (room <= 0) { setError(`Maximum ${maxImages} images allowed.`); return }
    const accepted: File[] = []
    for (const file of files) {
      if (!TYPES[file.type]) { setError('Only JPG, PNG or WebP images are allowed.'); continue }
      if (file.size > MAX_BYTES) { setError(`${file.name} is over 5 MB.`); continue }
      accepted.push(file)
    }
    if (accepted.length > room) setError(`Only ${room} more image${room === 1 ? '' : 's'} allowed; extra files were skipped.`)

    setUploading(true)
    let next = [...images]
    // One at a time, so the list is built from every upload, not just the last.
    for (const file of accepted.slice(0, room)) {
      const name = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${TYPES[file.type]}`
      const { error: uploadError } = await supabase.storage.from(BUCKET)
        .upload(name, file, { cacheControl: '3600', upsert: false, contentType: file.type })
      if (uploadError) { setError('Upload failed: ' + uploadError.message); break }
      next = [...next, supabase.storage.from(BUCKET).getPublicUrl(name).data.publicUrl]
      onImagesChange(next)
    }
    setUploading(false)
  }

  const removeImage = (index: number) => onImagesChange(images.filter((_, i) => i !== index))
  const makeCover = (index: number) => onImagesChange([images[index], ...images.filter((_, i) => i !== index)])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (fileInputRef.current) fileInputRef.current.value = ''
    void uploadFiles(files)
  }

  return (
    <div>
      {images.length > 0 && (
        <ul style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', margin: '0 0 10px', padding: 0, listStyle: 'none' }}>
          {images.map((url, i) => (
            <li key={url} style={{ position: 'relative', width: '96px' }}>
              <img src={url} alt={`Photo ${i + 1}${coverControl && i === 0 ? ' (cover)' : ''}`}
                style={{ width: '96px', height: '72px', objectFit: 'cover', borderRadius: '8px', border: i === 0 && coverControl ? '2px solid var(--ag-primary)' : '1px solid #E2E8F0', display: 'block', boxSizing: 'border-box' }} />
              <button type="button" onClick={() => removeImage(i)} aria-label={`Remove photo ${i + 1}`}
                style={{ position: 'absolute', top: '-8px', right: '-8px', width: '24px', height: '24px', borderRadius: '50%', background: '#B91C1C', color: '#fff', border: '2px solid #fff', cursor: 'pointer', fontSize: '13px', fontWeight: 700, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                ×
              </button>
              {coverControl && (i === 0 ? (
                <p style={{ margin: '4px 0 0', fontSize: '11px', fontWeight: 600, color: 'var(--ag-primary)', textAlign: 'center' }}>Cover</p>
              ) : (
                <button type="button" onClick={() => makeCover(i)}
                  style={{ margin: '4px 0 0', width: '100%', fontSize: '11px', color: '#475569', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
                  Make cover
                </button>
              ))}
            </li>
          ))}
        </ul>
      )}

      {images.length < maxImages && (
        <div>
          <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple
            onChange={handleFileChange} disabled={uploading} className="ag-sr-only" id={inputId} />
          <label htmlFor={inputId}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', width: '100%', padding: '12px', border: '1px dashed #CBD5E1', borderRadius: '8px', cursor: uploading ? 'not-allowed' : 'pointer', background: uploading ? '#F8FAFC' : '#fff', fontSize: '13px', color: '#475569', boxSizing: 'border-box' }}>
            {uploading ? 'Uploading…' : images.length === 0 ? 'Upload photos' : 'Add more photos'}
            <span style={{ fontSize: '11px', color: '#64748B' }}>({images.length}/{maxImages})</span>
          </label>
        </div>
      )}

      <p role="alert" style={{ fontSize: '12px', color: '#B91C1C', margin: error ? '6px 0 0' : 0 }}>{error}</p>
      <p style={{ fontSize: '11px', color: '#64748B', margin: '4px 0 0' }}>
        Up to {maxImages} photos, 5 MB each. JPG, PNG or WebP. Changes are kept only when you save.
      </p>
    </div>
  )
}
