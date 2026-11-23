import { X } from 'lucide-react'
import { Dialog } from 'radix-ui'
import { useTranslation } from 'react-i18next'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { describeError } from '@/lib/errors'
import { formatDuration, useCDR, type TranscriptLine } from '@/lib/ledger'

/**
 * The words spoken on one finished call, in a dialog over the ledger.
 *
 * It reads the same detail the call's own page does (`GET /cdrs/{callId}`), so
 * opening it from the list costs the one request that page would have made
 * anyway; the shared query cache answers a second look without another.
 *
 * Escape, a click on the overlay and the ✕ all close it, and focus stays
 * inside it while it is open, because this is the same Radix dialog the
 * record forms use rather than a hand-built overlay.
 */
export function TranscriptDialog({ callId, onClose }: { callId: string; onClose: () => void }) {
  const { t } = useTranslation()
  const { data, isPending, isError, error } = useCDR(callId)
  const lines = data?.transcript ?? []
  const startedAt = data?.cdr.startedAt ?? ''

  return (
    <Dialog.Root
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/20" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[75vh] w-[720px] max-w-[95vw] -translate-x-1/2 -translate-y-1/2 flex-col rounded-md border bg-card shadow-md">
          <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
            <div className="min-w-0">
              <Dialog.Title className="text-sm font-medium">{t('cdr.transcript')}</Dialog.Title>
              <Dialog.Description className="mt-0.5 text-xs tabular text-muted-foreground wrap-anywhere">
                {callId}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button
                size="icon-sm"
                variant="ghost"
                title={t('common.close')}
                aria-label={t('common.close')}
              >
                <X />
              </Button>
            </Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {isPending && <p className="text-xs text-muted-foreground">{t('common.loading')}</p>}
            {isError && <p className="text-xs text-muted-foreground">{describeError(error, t)}</p>}
            {!isPending && !isError && lines.length === 0 && (
              <p className="text-xs text-muted-foreground">{t('cdr.noTranscript')}</p>
            )}
            {lines.length > 0 && <TranscriptLines lines={lines} startedAt={startedAt} />}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/**
 * One call's transcript, in order, with the time each line was spoken counted
 * from the start of the call so it reads against the recording. The call page
 * and the dialog over the ledger show the same list, so they share it rather
 * than keeping two copies that can drift apart.
 */
export function TranscriptLines({
  lines,
  startedAt,
}: {
  lines: TranscriptLine[]
  startedAt: string
}) {
  return (
    <ol className="space-y-2">
      {lines.map((entry) => (
        <TranscriptRow key={entry.seq} entry={entry} startedAt={startedAt} />
      ))}
    </ol>
  )
}

/** Seconds into the call, so the transcript reads against the recording. */
function offsetLabel(occurredAt: string, startedAt: string): string {
  const offset = (new Date(occurredAt).getTime() - new Date(startedAt).getTime()) / 1000
  return formatDuration(offset)
}

function TranscriptRow({ entry, startedAt }: { entry: TranscriptLine; startedAt: string }) {
  const { t } = useTranslation()
  const isCustomer = entry.speaker === 'CUSTOMER'

  let body: ReactNode
  if (entry.kind === 'TEXT') {
    body = <span>{String(entry.content.text ?? '')}</span>
  } else if (entry.kind === 'TOOL_CALL') {
    body = (
      <span className="text-muted-foreground">
        {t('cdr.toolCalled', { tool: String(entry.content.name ?? '') })}
      </span>
    )
  } else if (entry.kind === 'TOOL_RESULT') {
    body = (
      <span className="text-muted-foreground">
        {t('cdr.toolAnswered', { tool: String(entry.content.name ?? '') })}
      </span>
    )
  } else {
    body = <span className="text-muted-foreground">{JSON.stringify(entry.content)}</span>
  }

  return (
    <li className="flex gap-3 text-[13px]">
      <span className="w-12 shrink-0 pt-px text-right text-xs tabular text-muted-foreground">
        {offsetLabel(entry.occurredAt, startedAt)}
      </span>
      <span
        className={`w-14 shrink-0 pt-px text-xs font-medium ${
          isCustomer ? 'text-foreground' : 'text-primary'
        }`}
      >
        {t(`cdr.speakers.${entry.speaker}`)}
      </span>
      <span className="min-w-0 flex-1 wrap-anywhere">{body}</span>
    </li>
  )
}
