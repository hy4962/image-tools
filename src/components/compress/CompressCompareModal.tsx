import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Maximize2, Minus, Plus, X } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { formatFileSize } from '../../utils/imageProcessing'
import type { ImageFile } from '../../types'

interface CompressCompareModalProps {
  image: ImageFile
  onClose: () => void
}

const MIN_ZOOM = 1
const MAX_ZOOM = 4
const MAX_VIEWPORT_RATIO = 0.65

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

/**
 * 压缩前后对比弹窗：底层铺压缩结果，左侧按裁剪宽度盖一层原图。
 *
 * 两个 blob URL 都由本组件创建并回收，不复用 ImageFile.preview ——
 * 那个 URL 是列表缩略图持有的，弹窗里 revoke 会让缩略图变空白。
 *
 * 缩放下竖线仍然固定在视口上；原图层的裁剪边界要换算成「内容坐标」，
 * 否则放大平移后左右两侧会错位。
 */
export function CompressCompareModal({ image, onClose }: CompressCompareModalProps) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const dragModeRef = useRef<'compare' | 'pan' | null>(null)
  const dragStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 })
  const [position, setPosition] = useState(50)
  const [zoom, setZoom] = useState(MIN_ZOOM)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [viewportWidth, setViewportWidth] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)
  const [natural, setNatural] = useState({ w: 0, h: 0 })

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

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const measure = () => {
      const width = element.clientWidth
      setViewportWidth((prev) => (prev === width ? prev : width))
      const height = window.innerHeight * MAX_VIEWPORT_RATIO
      setViewportHeight((prev) => (prev === height ? prev : height))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  // 适应窗口时的实际显示尺寸：宽满容器，但高度不超过 65vh。
  const fitW = natural.w && natural.h
    ? Math.min(viewportWidth, (viewportHeight * natural.w) / natural.h)
    : viewportWidth
  const fitH = natural.w && natural.h ? (fitW * natural.h) / natural.w : 0

  const contentW = fitW * zoom
  const contentH = fitH * zoom
  const baseLeft = (viewportWidth - contentW) / 2
  const baseTop = (fitH - contentH) / 2

  const clampPan = useCallback(
    (next: { x: number; y: number }, nextZoom: number) => {
      const width = fitW * nextZoom
      const height = fitH * nextZoom
      const left = (viewportWidth - width) / 2
      const top = (fitH - height) / 2
      return {
        x: width <= viewportWidth ? 0 : clamp(next.x, viewportWidth - width - left, -left),
        y: height <= fitH ? 0 : clamp(next.y, fitH - height - top, -top),
      }
    },
    [fitH, fitW, viewportWidth],
  )

  const safePan = clampPan(pan, zoom)
  const contentLeft = baseLeft + safePan.x
  const contentTop = baseTop + safePan.y
  // 竖线位置是视口百分比；换算成内容图层里的裁剪百分比。
  const boundaryInContent = (position / 100) * viewportWidth - contentLeft
  const clipRight = contentW > 0
    ? clamp(100 - (boundaryInContent / contentW) * 100, 0, 100)
    : 100

  const moveDivider = useCallback((clientX: number) => {
    const element = containerRef.current
    if (!element) return
    const rect = element.getBoundingClientRect()
    if (rect.width === 0) return
    const ratio = ((clientX - rect.left) / rect.width) * 100
    setPosition(clamp(ratio, 0, 100))
  }, [])

  const onContainerPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    if (zoom > 1) {
      dragModeRef.current = 'pan'
      dragStartRef.current = {
        x: event.clientX,
        y: event.clientY,
        panX: safePan.x,
        panY: safePan.y,
      }
    } else {
      dragModeRef.current = 'compare'
      moveDivider(event.clientX)
    }
  }

  const onContainerPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragModeRef.current) return
    if (dragModeRef.current === 'compare') {
      moveDivider(event.clientX)
      return
    }
    setPan(
      clampPan(
        {
          x: dragStartRef.current.panX + (event.clientX - dragStartRef.current.x),
          y: dragStartRef.current.panY + (event.clientY - dragStartRef.current.y),
        },
        zoom,
      ),
    )
  }

  const endDrag = () => {
    dragModeRef.current = null
  }

  // React 的 wheel 是被动监听，preventDefault 不生效；用原生监听挂在容器上。
  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const onWheel = (event: WheelEvent) => {
      if (zoom === MIN_ZOOM && event.deltaY > 0) return
      event.preventDefault()
      const rect = element.getBoundingClientRect()
      const cursorX = event.clientX - rect.left
      const cursorY = event.clientY - rect.top
      const factor = event.deltaY < 0 ? 1.25 : 1 / 1.25
      const nextZoom = clamp(
        Math.round(zoom * factor * 100) / 100,
        MIN_ZOOM,
        MAX_ZOOM,
      )
      if (nextZoom === zoom) return
      const focusX = contentW > 0 ? (cursorX - contentLeft) / contentW : 0.5
      const focusY = contentH > 0 ? (cursorY - contentTop) / contentH : 0.5
      const nextW = fitW * nextZoom
      const nextH = fitH * nextZoom
      const nextLeft = (viewportWidth - nextW) / 2
      const nextTop = (fitH - nextH) / 2
      setZoom(nextZoom)
      setPan(
        clampPan(
          {
            x: cursorX - focusX * nextW - nextLeft,
            y: cursorY - focusY * nextH - nextTop,
          },
          nextZoom,
        ),
      )
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [clampPan, contentH, contentLeft, contentTop, contentW, fitH, fitW, viewportWidth, zoom])

  const changeZoom = (nextZoom: number) => {
    const value = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM)
    setZoom(value)
    setPan((previous) => clampPan(previous, value))
  }

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

  const zoomControls = (
    <div className="flex flex-shrink-0 items-center gap-1 rounded-lg bg-neutral-100 p-0.5 dark:bg-neutral-800">
      <button
        type="button"
        onClick={() => changeZoom(zoom - 0.5)}
        disabled={zoom <= MIN_ZOOM}
        aria-label={t.compressZoomOut}
        title={t.compressZoomOut}
        className="flex size-7 items-center justify-center rounded-md text-neutral-600 transition hover:bg-white disabled:opacity-40 dark:text-neutral-300 dark:hover:bg-neutral-700"
      >
        <Minus className="size-4" />
      </button>
      <span className="w-11 text-center font-mono text-xs text-neutral-600 dark:text-neutral-300">
        {Math.round(zoom * 100)}%
      </span>
      <button
        type="button"
        onClick={() => changeZoom(zoom + 0.5)}
        disabled={zoom >= MAX_ZOOM}
        aria-label={t.compressZoomIn}
        title={t.compressZoomIn}
        className="flex size-7 items-center justify-center rounded-md text-neutral-600 transition hover:bg-white disabled:opacity-40 dark:text-neutral-300 dark:hover:bg-neutral-700"
      >
        <Plus className="size-4" />
      </button>
      <button
        type="button"
        onClick={() => changeZoom(MIN_ZOOM)}
        disabled={zoom === MIN_ZOOM}
        aria-label={t.compressZoomFit}
        title={t.compressZoomFit}
        className="flex size-7 items-center justify-center rounded-md text-neutral-600 transition hover:bg-white disabled:opacity-40 dark:text-neutral-300 dark:hover:bg-neutral-700"
      >
        <Maximize2 className="size-3.5" />
      </button>
    </div>
  )

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
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
              {image.file.name}
            </p>
            <p className="mt-0.5 font-mono text-[11px] text-neutral-500 dark:text-neutral-400">
              {formatFileSize(image.originalSize)} → {formatFileSize(image.compressedSize ?? 0)}
              {image.outputType ? ` · ${image.outputType.toUpperCase()}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {zoomControls}
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
        </div>

        <div className="min-h-0 overflow-auto p-3 sm:p-5">
          <div
            ref={containerRef}
            onPointerDown={onContainerPointerDown}
            onPointerMove={onContainerPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            style={{ height: Math.max(fitH, 160) }}
            className={[
              'checkerboard relative w-full touch-none overflow-hidden rounded-xl border border-neutral-200 select-none dark:border-neutral-700',
              zoom > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-ew-resize',
            ].join(' ')}
          >
            <div
              className="pointer-events-none absolute left-0 top-0"
              style={{
                width: contentW,
                height: contentH,
                transform: `translate(${contentLeft}px, ${contentTop}px)`,
              }}
            >
              <img
                src={afterUrl}
                alt={t.compressAfter}
                draggable={false}
                onLoad={(event) =>
                  setNatural({
                    w: event.currentTarget.naturalWidth,
                    h: event.currentTarget.naturalHeight,
                  })
                }
                className="block size-full object-fill"
              />
              <div
                className="absolute inset-0 overflow-hidden"
                style={{ clipPath: `inset(0 ${clipRight}% 0 0)` }}
              >
                <img
                  src={beforeUrl}
                  alt={t.compressBefore}
                  draggable={false}
                  className="block size-full object-fill"
                />
              </div>
            </div>

            <div
              role="slider"
              tabIndex={0}
              aria-label={t.compressCompareHint}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(position)}
              onKeyDown={onSliderKeyDown}
              onPointerDown={(event) => {
                event.stopPropagation()
                event.currentTarget.parentElement?.setPointerCapture(event.pointerId)
                dragModeRef.current = 'compare'
                moveDivider(event.clientX)
              }}
              style={{ left: `${position}%` }}
              className="absolute inset-y-0 z-10 w-0.5 cursor-ew-resize bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.25)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
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
            {zoom > 1 ? t.compressCompareZoomHint : t.compressCompareHint}
          </p>
        </div>
      </div>
    </div>
  )
}
