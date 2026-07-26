'use client'

import { useState, useRef } from 'react'
import { supabase } from '@/lib/supabase'

interface ImageUploadProps {
  folder: string
  existingImages?: string[]
  onImagesChange: (urls: string[]) => void
  maxImages?: number
}

export default function ImageUpload({ folder, existingImages = [], onImagesChange, maxImages = 5 }: ImageUploadProps) {
  const [images, setImages] = useState<string[]>(existingImages)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const uploadImage = async (file: File) => {
    if (images.length >= maxImages) {
      setError(`Maximum ${maxImages} images allowed`)
      return
    }

    if (!file.type.startsWith('image/')) {
      setError('Only image files are allowed')
      return
    }

    if (file.size > 5 * 1024 * 1024) {
      setError('Image must be under 5MB')
      return
    }

    setUploading(true)
    setError('')

    const fileExt = file.name.split('.').pop()
    const fileName = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.${fileExt}`

    const { data, error: uploadError } = await supabase.storage
      .from('images')
      .upload(fileName, file, { cacheControl: '3600', upsert: false })

    if (uploadError) {
      setError('Upload failed: ' + uploadError.message)
      setUploading(false)
      return
    }

    const { data: urlData } = supabase.storage.from('images').getPublicUrl(fileName)
    const publicUrl = urlData.publicUrl

    const newImages = [...images, publicUrl]
    setImages(newImages)
    onImagesChange(newImages)
    setUploading(false)
  }

  const removeImage = async (url: string, index: number) => {
    const path = url.split('/images/')[1]
    if (path) {
      await supabase.storage.from('images').remove([path])
    }
    const newImages = images.filter((_, i) => i !== index)
    setImages(newImages)
    onImagesChange(newImages)
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    files.forEach(file => uploadImage(file))
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <div>
      {/* Existing images */}
      {images.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
          {images.map((url, i) => (
            <div key={url} style={{ position: 'relative', width: '80px', height: '80px' }}>
              <img
                src={url}
                alt={`Image ${i + 1}`}
                style={{ width: '80px', height: '80px', objectFit: 'cover', borderRadius: '8px', border: '0.5px solid #E2E8F0' }}
              />
              <button
                onClick={() => removeImage(url, i)}
                style={{
                  position: 'absolute', top: '-6px', right: '-6px',
                  width: '20px', height: '20px', borderRadius: '50%',
                  background: '#DC2626', color: '#fff', border: 'none',
                  cursor: 'pointer', fontSize: '12px', fontWeight: '700',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Upload button */}
      {images.length < maxImages && (
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleFileChange}
            style={{ display: 'none' }}
            id="image-upload"
          />
          <label
            htmlFor="image-upload"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: '8px', width: '100%', padding: '12px',
              border: '1px dashed #CBD5E1', borderRadius: '8px',
              cursor: uploading ? 'not-allowed' : 'pointer',
              background: uploading ? '#F8FAFC' : '#fff',
              fontSize: '13px', color: '#64748B', boxSizing: 'border-box',
            }}
          >
            {uploading ? (
              <>
                <span style={{ fontSize: '16px' }}>⏳</span>
                Uploading...
              </>
            ) : (
              <>
                <span style={{ fontSize: '16px' }}>📸</span>
                {images.length === 0 ? 'Upload images' : 'Add more images'}
                <span style={{ fontSize: '11px', color: '#94A3B8' }}>
                  ({images.length}/{maxImages})
                </span>
              </>
            )}
          </label>
        </div>
      )}

      {error && (
        <p style={{ fontSize: '12px', color: '#DC2626', margin: '6px 0 0' }}>{error}</p>
      )}
      <p style={{ fontSize: '11px', color: '#94A3B8', margin: '4px 0 0' }}>
        Max {maxImages} images, up to 5MB each. JPG, PNG, WEBP supported.
      </p>
    </div>
  )
}
