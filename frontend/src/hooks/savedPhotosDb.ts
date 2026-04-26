/** IndexedDB persistence for Frame Mog saved session captures. */

const DB = 'frame-mog-saved-photos-v1'
const STORE = 'photos'
const VERSION = 1

export interface SavedPhotoRecord {
  id: string
  imageBase64: string
  poseName: string
  matchConfidence: number
  occasionType: string
  capturedAt: string
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
  })
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => {
      const s = r.result
      if (typeof s === 'string') resolve(s.split(',')[1] ?? s)
      else reject(new Error('read failed'))
    }
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}

function dataUrlToBlob(dataUrl: string, mime: string): Blob {
  const comma = dataUrl.indexOf(',')
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl
  const bin = atob(b64)
  const u8 = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) u8[i] = bin.charCodeAt(i)
  return new Blob([u8], { type: mime })
}

export async function loadAllPhotos(): Promise<SavedPhotoRecord[]> {
  if (typeof indexedDB === 'undefined') return []
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const st = tx.objectStore(STORE)
    const g = st.getAll()
    g.onsuccess = () => {
      const rows = g.result
      db.close()
      if (!Array.isArray(rows)) {
        resolve([])
        return
      }
      resolve(rows as SavedPhotoRecord[])
    }
    g.onerror = () => {
      db.close()
      reject(g.error)
    }
  })
}

export async function putPhoto(row: SavedPhotoRecord): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.oncomplete = () => {
      db.close()
      resolve()
    }
    tx.onerror = () => {
      db.close()
      reject(tx.error)
    }
    tx.objectStore(STORE).put(row)
  })
}

export function recordToBlob(r: SavedPhotoRecord): { blob: Blob; mime: string } {
  return {
    blob: dataUrlToBlob(r.imageBase64, 'image/jpeg'),
    mime: 'image/jpeg',
  }
}

export async function trimToMax(max: number): Promise<void> {
  if (typeof indexedDB === 'undefined' || max < 1) return
  const all = await loadAllPhotos()
  if (all.length <= max) return
  all.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))
  const db = await openDb()
  const drop = all.slice(max)
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.oncomplete = () => {
      db.close()
      resolve()
    }
    tx.onerror = () => {
      db.close()
      reject(tx.error)
    }
    for (const row of drop) {
      tx.objectStore(STORE).delete(row.id)
    }
  })
}
