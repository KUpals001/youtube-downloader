'use client'

import { logger } from "@/lib/logger";

import { useState, useEffect, useRef } from 'react'
import { Header } from '@/components/Header'
import { UrlInput } from '@/components/UrlInput'
import { MediaCard } from '@/components/MediaCard'
import { DlState } from '@/components/ui/ProgressBar'
import { simplifyError, MIME_MAP } from '@/lib/client-utils'
import { MediaInfo } from '@/lib/types'
import FavoriteIcon from '@/app/assets/icons/FavoriteIcon'

interface WindowWithFilePicker extends Window {
  showSaveFilePicker?: (options?: {
    suggestedName?: string
    types?: Array<{
      description: string
      accept: Record<string, string[]>
    }>
  }) => Promise<FileSystemFileHandle>
}

type Status = 'idle' | 'loading' | 'success' | 'error'

const BLANK_DL: DlState = {
  status: 'idle',
  progress: 0,
  indeterminate: false,
  error: '',
  filename: '',
}

const DEBOUNCE_MS = 800

/**
 * Main Home page component.
 * Handles URL input, media info fetching, and download orchestration.
 * 
 * @returns The home page element.
 */
export default function Home() {
  const [url, setUrl] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [info, setInfo] = useState<MediaInfo | null>(null)
  const [errMsg, setErrMsg] = useState('')
  const [dlState, setDlState] = useState<DlState>(BLANK_DL)

  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    clearTimeout(timer.current)
    setDlState(BLANK_DL)
    const trimmed = url.trim()
    if (!trimmed) {
      setStatus('idle')
      setInfo(null)
      setErrMsg('')
      return
    }

    setStatus('loading')
    setInfo(null)
    setErrMsg('')

    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/info?url=${encodeURIComponent(trimmed)}`)
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Failed to fetch')
        setInfo(data)
        setStatus('success')
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : String(e)
        setErrMsg(simplifyError(errorMessage))
        setStatus('error')
      }
    }, DEBOUNCE_MS)

    return () => clearTimeout(timer.current)
  }, [url])

  /**
   * Orchestrates the download process.
   * Handles streaming progress updates and binary data saving.
   * 
   * @param options - Download settings.
   */
  const download = async (options: {
    mode: 'video' | 'audio'
    quality: string
    ext: string
    rmSponsor: boolean
    rmMusic: boolean
    addMetadata: boolean
    mbId?: string
    discogsId?: string
    deezerId?: string
    artistDelimiter?: string
    overrideUrl?: string
    overrideTitle?: string
  }) => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    const targetUrl = options.overrideUrl ?? url
    const targetTitle = options.overrideTitle ?? info?.title ?? 'download'
    const isPlaylist = options.overrideUrl ? false : (info?.isPlaylist ?? false)
    const outExt = isPlaylist ? 'zip' : options.ext
    const safeTitle = targetTitle.replace(/[\/\\:*?"<>|]/g, '_')
    const filename = `${safeTitle}.${outExt}`

    const params = new URLSearchParams({
      url: targetUrl,
      mode: options.mode,
      ext: options.ext,
      quality: options.quality,
      isPlaylist: isPlaylist.toString(),
      removeSponsor: options.rmSponsor.toString(),
      removeNonMusic: options.rmMusic.toString(),
      title: targetTitle,
      channel: info?.uploader ?? '',
      uploadDate: info?.uploadDate ?? '',
      addMetadata: options.addMetadata.toString(),
      ...(options.mbId ? { mbId: options.mbId } : {}),
      ...(options.discogsId ? { discogsId: options.discogsId } : {}),
      ...(options.deezerId ? { deezerId: options.deezerId } : {}),
      ...(options.artistDelimiter ? { artistDelimiter: options.artistDelimiter } : {}),
    })

    const win = window as WindowWithFilePicker
    const supportsFilePicker = typeof win.showSaveFilePicker === 'function'
    let fileHandle: FileSystemFileHandle | null = null

    if (supportsFilePicker && win.showSaveFilePicker) {
      try {
        fileHandle = await win.showSaveFilePicker({
          suggestedName: filename,
          types: [{ description: 'Media file', accept: { [MIME_MAP[outExt] ?? 'application/octet-stream']: [`.${outExt}`] } }],
        })
      } catch {
        return
      }
    }

    setDlState({ status: 'active', progress: 0, indeterminate: true, error: '', filename: '' })

    try {
      const res = await fetch(`/api/download?${params}`, { signal: ctrl.signal })
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Download failed' }))
        throw new Error(data.error ?? 'Download failed')
      }

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()

      let metadataBuffer = new Uint8Array()
      let binaryChunks: Uint8Array[] = []
      let isBinary = false
      let totalFileSize = 0
      let receivedBinary = 0
      let delimiterFound = false

      function findDoubleNewline(buf: Uint8Array): number {
        for (let i = 0; i < buf.length - 1; i++) {
          if (buf[i] === 10 && buf[i + 1] === 10) return i
        }
        return -1
      }

      function applyMsg(msg: Record<string, unknown>) {
        if (msg.type === 'download') {
          const progress = typeof msg.progress === 'number' ? msg.progress : undefined
          const current = typeof msg.current === 'number' ? msg.current : undefined
          const total = typeof msg.total === 'number' ? msg.total : undefined
          const currentItemProgress = typeof msg.currentItemProgress === 'number' ? msg.currentItemProgress : undefined
          setDlState((s) => ({
            ...s,
            phase: 'downloading',
            indeterminate: false,
            ...(progress != null && { progress }),
            ...(current != null && { currentIndex: current }),
            ...(total != null && { totalCount: total }),
            ...(currentItemProgress != null && { currentItemProgress }),
          }))
        } else if (msg.type === 'tagging') {
          const progress = typeof msg.progress === 'number' ? msg.progress : undefined
          const current = typeof msg.current === 'number' ? msg.current : undefined
          const total = typeof msg.total === 'number' ? msg.total : undefined
          const currentItemProgress = typeof msg.currentItemProgress === 'number' ? msg.currentItemProgress : undefined
          setDlState((s) => ({
            ...s,
            phase: 'tagging',
            indeterminate: false,
            ...(progress != null && { progress }),
            ...(current != null && { currentIndex: current }),
            ...(total != null && { totalCount: total }),
            ...(currentItemProgress != null && { currentItemProgress }),
          }))
        } else if (msg.type === 'progress') {
          const cur = msg.current as number
          const tot = msg.total as number
          setDlState((s) => ({
            ...s,
            phase: 'tagging',
            indeterminate: false,
            progress: tot > 0 ? (cur - 1) / tot : 0,
            currentIndex: cur,
            totalCount: tot,
            currentItemProgress: 0,
            statusText: msg.title ? `Processing ${cur}/${tot}: ${msg.title}` : undefined,
          }))
        } else if (msg.type === 'file') {
          totalFileSize = msg.size as number
          setDlState((s) => ({
            ...s,
            phase: 'zipping',
            indeterminate: false,
            progress: 0,
            statusText: isPlaylist ? 'Downloading zip…' : 'Saving file…',
          }))
        } else if (msg.type === 'converting') {
          setDlState((s) => ({
            ...s,
            phase: 'converting',
            indeterminate: true,
            statusText: 'Converting format…',
          }))
        } else if (msg.type === 'start') {
          setDlState((s) => ({
            ...s,
            phase: 'downloading',
            indeterminate: false,
            progress: 0,
            statusText: 'Downloading…',
          }))
        } else if (msg.type === 'error') {
          throw new Error(msg.message as string)
        }
      }

      function processMetadataChunk(bytes: Uint8Array): number {
        const text = decoder.decode(bytes)
        const lines = text.split('\n')
        for (const line of lines) {
          const trimmed = line.trim()
          if (trimmed === '') continue
          try {
            const msg = JSON.parse(trimmed) as Record<string, unknown>
            applyMsg(msg)
          } catch (e) {
            if (e instanceof Error && e.message !== 'Unexpected token') {
              throw e
            }
          }
        }
        return lines.length
      }

      logger.log('[client] Starting download stream for', filename)

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        if (!isBinary) {
          const newBuffer = new Uint8Array(metadataBuffer.length + value.length)
          newBuffer.set(metadataBuffer)
          newBuffer.set(value, metadataBuffer.length)
          metadataBuffer = newBuffer

          const delimiterIndex = findDoubleNewline(metadataBuffer)
          if (delimiterIndex !== -1) {
            delimiterFound = true
            const metadataBytes = metadataBuffer.slice(0, delimiterIndex + 1)
            processMetadataChunk(metadataBytes)
            const binaryStart = delimiterIndex + 2
            isBinary = true
            if (binaryStart < metadataBuffer.length) {
              const binaryRemainder = metadataBuffer.slice(binaryStart)
              binaryChunks.push(binaryRemainder)
              if (totalFileSize > 0) {
                receivedBinary += binaryRemainder.length
                setDlState((s) => ({ ...s, progress: receivedBinary / totalFileSize }))
              }
            }
            metadataBuffer = new Uint8Array(0)
          } else {
            const lastNewline = metadataBuffer.lastIndexOf(10)
            if (lastNewline >= 0) {
              const completePart = metadataBuffer.slice(0, lastNewline + 1)
              processMetadataChunk(completePart)
              metadataBuffer = metadataBuffer.slice(lastNewline + 1)
            }
          }
        } else {
          binaryChunks.push(value)
          if (totalFileSize > 0) {
            receivedBinary += value.length
            setDlState((s) => ({ ...s, progress: receivedBinary / totalFileSize }))
          }
        }
      }

      if (!delimiterFound && metadataBuffer.length > 0) {
        const metadataText = decoder.decode(metadataBuffer)
        const lines = metadataText.split('\n').filter(l => l.trim() !== '')
        for (const line of lines) {
          let msg
          try {
            msg = JSON.parse(line)
          } catch {
            continue
          }
          if (msg.type === 'error') {
            throw new Error(msg.message)
          }
        }
        if (binaryChunks.length === 0) {
          throw new Error('No data received from server')
        }
      }

      if (binaryChunks.length === 0) {
        throw new Error('No data received from server')
      }

      if (fileHandle) {
        const writable = await fileHandle.createWritable()
        for (const chunk of binaryChunks) {
          await writable.write(chunk.slice())
        }
        await writable.close()
      } else {
        const blob = new Blob(binaryChunks.map(chunk => chunk.slice()), { type: MIME_MAP[outExt] ?? 'application/octet-stream' })
        const blobUrl = URL.createObjectURL(blob)
        const a = Object.assign(document.createElement('a'), { href: blobUrl, download: filename })
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000)
      }

      setDlState({
        status: 'done',
        progress: 1,
        indeterminate: false,
        error: '',
        filename,
      })
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return
      const errorMessage = e instanceof Error ? e.message : 'Download failed'
      setDlState({
        status: 'error',
        progress: 0,
        indeterminate: false,
        error: simplifyError(errorMessage),
        filename: '',
      })
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-zinc-950 font-sans">
      <Header />
      <main className="max-w-5xl mx-auto px-4 py-8 space-y-4">
        <UrlInput url={url} setUrl={setUrl} status={status} errorMsg={errMsg} />

        {status === 'success' && info && (
          <MediaCard
            info={info}
            dlState={dlState}
            onDownload={download}
            onDismissProgress={() => setDlState(BLANK_DL)}
          />
        )}

        <p className="text-center text-xs text-gray-300 dark:text-zinc-700">
          <span className="flex gap-2 items-center text-lg justify-center">
            Made with <FavoriteIcon className="text-lg text-red-900" /> by elpideus
          </span>
        </p>
      </main>
    </div>
  )
}