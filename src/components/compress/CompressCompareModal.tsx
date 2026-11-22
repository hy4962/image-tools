import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { formatFileSize } from '../../utils/imageProcessing'
import type { ImageFile } from '../../types'

interface CompressCompareModalProps {
  image: ImageFile
  onClose: () => void
}

/**
 * 压缩前后对比弹窗：底层铺压缩结果，左侧按裁剪宽度盖一层原图。
 *
 * 两个 blob URL 都由本组件创建并回收，不复用 ImageFile.preview ——
 * 那个 URL 是列表缩略图持有的，弹窗里 revoke 会让缩略图变空白。
 */
export function CompressCompareModal({ image, onClose }: CompressCompareModalProps) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)
  const [position, setPosition] = useState(50)

  const beforeUrl = useMemo(() => URL.createObjectURL(image.file), [image.file])
  const afterUrl = useMemo(
    () => (image.blob ? URL.createObjectURL(image.blob) : ''),
    [image.blob],
  )

  useEffect(() => {
    return () => {
      URL.revokeObjectURL(beforeUrl)
      if (afterUrl) URL.revokeObjectURL(afterUrl)
    }
  }, [beforeUrl, afterUrl])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [onClose])

  const moveTo = useCallback((clientX: number) => {
    const element = containerRef.current
    if (!element) return
    const rect = element.getBoundingClientRect()
    if (rect.width === 0) return
    const ratio = ((clientX - rect.left) / rect.width) * 100
    setPosition(Math.min(100, Math.max(0, ratio)))
  }, [])

  const onSliderKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 10 : 2
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      setPosition((value) => Math.max(0, value - step))
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      setPosition((value) => Math.min(100, value + step))
    } else if (event.key === 'Home') {
      event.preventDefault()
      setPosition(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      setPosition(100)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/70 p-3 backdrop-blur-sm sm:p-6"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t.compressCompareTitle(image.file.name)}
        className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-neutral-900"
      >
        <div className="flex items-center justify-between gap-3 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
              {image.file.name}
            </p>
            <p className="mt-0.5 font-mono text-[11px] text-neutral-500 dark:text-neutral-400">
              {formatFileSize(image.originalSize)} → {formatFileSize(image.compressedSize ?? 0)}
              {image.outputType ? ` · ${image.outputType.toUpperCase()}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.compressCompareClose}
            title={t.compressCompareClose}
            className="flex size-8 flex-shrink-0 items-center justify-center rounded-lg text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="min-h-0 overflow-auto p-3 sm:p-5">
          <div
            ref={containerRef}
            onPointerDown={(event) => {
              draggingRef.current = true
              event.currentTarget.setPointerCapture(event.pointerId)
              moveTo(event.clientX)
            }}
            onPointerMove={(event) => {
              if (draggingRef.current) moveTo(event.clientX)
            }}
            onPointerUp={() => {
              draggingRef.current = false
            }}
            onPointerCancel={() => {
              draggingRef.current = false
            }}
            className="checkerboard relative w-full cursor-ew-resize touch-none overflow-hidden rounded-xl border border-neutral-200 select-none dark:border-neutral-700"
          >
            <img
              src={afterUrl}
              alt={t.compressAfter}
              draggable={false}
              className="block max-h-[65vh] w-full object-contain"
            />
            <div
              className="pointer-events-none absolute inset-0 overflow-hidden"
              style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
            >
              <img
                src={beforeUrl}
                alt={t.compressBefore}
                draggable={false}
                className="block max-h-[65vh] w-full object-contain"
              />
            </div>

            <div
              role="slider"
              tabIndex={0}
              aria-label={t.compressCompareHint}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(position)}
              onKeyDown={onSliderKeyDown}
              style={{ left: `${position}%` }}
              className="absolute inset-y-0 z-10 w-0.5 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.25)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <div className="absolute top-1/2 left-1/2 flex size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white ring-1 ring-black/10">
                <svg viewBox="0 0 24 24" className="size-4 text-neutral-600" fill="currentColor">
                  <path d="M9.5 7 5 12l4.5 5V7Zm5 0v10l4.5-5-4.5-5Z" />
                </svg>
              </div>
            </div>

            <span className="pointer-events-none absolute top-3 left-3 rounded-md bg-black/60 px-2 py-1 text-xs font-medium text-white">
              {t.compressBefore}
            </span>
            <span className="pointer-events-none absolute top-3 right-3 rounded-md bg-blue-600/90 px-2 py-1 text-xs font-medium text-white">
              {t.compressAfter}
            </span>
          </div>
          <p className="mt-3 text-center text-xs text-neutral-500 dark:text-neutral-400">
            {t.compressCompareHint}
          </p>
        </div>
      </div>
    </div>
  )
}
