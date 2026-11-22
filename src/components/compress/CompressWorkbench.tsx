import { useCallback, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useImageQueue } from '../../hooks/useImageQueue'
import type {
  CompressionOptions as CompressionOptionsType,
  ImageFile,
  OutputType,
} from '../../types'
import { DEFAULT_QUALITY_SETTINGS } from '../../utils/formatDefaults'
import { CompressCompareModal } from './CompressCompareModal'
import { CompressionOptions } from '../CompressionOptions'
import { DownloadAll } from '../DownloadAll'
import { DropZone } from '../DropZone'
import { ImageList } from '../ImageList'

/**
 * 压缩工作区：批量队列，WASM 编解码，全部在本地跑。
 */
export function CompressWorkbench() {
  const { t } = useTranslation()
  const [images, setImages] = useState<ImageFile[]>([])
  const [outputType, setOutputType] = useState<OutputType>('webp')
  const [compareId, setCompareId] = useState<string | null>(null)
  const [options, setOptions] = useState<CompressionOptionsType>({
    quality: DEFAULT_QUALITY_SETTINGS.webp,
  })

  const { addToQueue } = useImageQueue(options, outputType, setImages)

  const handleOutputTypeChange = useCallback((type: OutputType) => {
    setOutputType(type)
    if (type !== 'png') {
      setOptions({ quality: DEFAULT_QUALITY_SETTINGS[type] })
    }
  }, [])

  const handleFilesDrop = useCallback(
    (newImages: ImageFile[]) => {
      // 先把所有图片推进 state
      setImages((prev) => [...prev, ...newImages])

      // 用 requestAnimationFrame 等这一轮渲染结束，再开始排队处理
      requestAnimationFrame(() => {
        newImages.forEach((image) => addToQueue(image.id))
      })
    },
    [addToQueue],
  )

  const handleRemoveImage = useCallback((id: string) => {
    setImages((prev) => {
      const image = prev.find((img) => img.id === id)
      if (image?.preview) {
        URL.revokeObjectURL(image.preview)
      }
      return prev.filter((img) => img.id !== id)
    })
  }, [])

  const handleClearAll = useCallback(() => {
    images.forEach((image) => {
      if (image.preview) {
        URL.revokeObjectURL(image.preview)
      }
    })
    setImages([])
  }, [images])

  const handleDownloadAll = useCallback(async () => {
    const completedImages = images.filter((img) => img.status === 'complete')

    for (const image of completedImages) {
      if (image.blob && image.outputType) {
        const link = document.createElement('a')
        link.href = URL.createObjectURL(image.blob)
        link.download = `${image.file.name.split('.')[0]}.${image.outputType}`
        link.click()
        URL.revokeObjectURL(link.href)
      }

      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }, [images])

  const closeCompare = useCallback(() => setCompareId(null), [])
  const completedImages = images.filter((img) => img.status === 'complete').length
  // 按 id 反查而不是存整份 image：列表里这张图被移除时弹窗会自己消失
  const compareImage = images.find((img) => img.id === compareId) ?? null

  return (
    <div className="space-y-6">
      <CompressionOptions
        options={options}
        outputType={outputType}
        onOptionsChange={setOptions}
        onOutputTypeChange={handleOutputTypeChange}
      />

      <DropZone onFilesDrop={handleFilesDrop} />

      {completedImages > 0 && (
        <DownloadAll onDownloadAll={handleDownloadAll} count={completedImages} />
      )}

      <ImageList
        images={images}
        onRemove={handleRemoveImage}
        onCompare={(image) => setCompareId(image.id)}
      />

      {compareImage?.status === 'complete' && compareImage.blob && (
        <CompressCompareModal image={compareImage} onClose={closeCompare} />
      )}

      {images.length > 0 && (
        <button
          onClick={handleClearAll}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-neutral-300 bg-white px-4 py-2 text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
        >
          <Trash2 className="h-5 w-5" />
          {t.clearAll}
        </button>
      )}
    </div>
  )
}
