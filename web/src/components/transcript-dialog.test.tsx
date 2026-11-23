import { screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/lib/i18n'
import type { CDR, TranscriptLine } from '@/lib/ledger'
import { installBackend, renderWithProviders } from '@/test/harness'

import { TranscriptDialog } from './transcript-dialog'

/**
 * The transcript dialog reads one call's detail through `useCDR`, so it is
 * tested against the request it makes: the lines, the time each was spoken
 * counted from the start of the call, the speaker, and the three ways out.
 */

const CALL_ID = '0199f3a2-7c41-7d22-9b1e-000000000001'
const STARTED_AT = '2026-10-20T09:12:00Z'

function cdr(): CDR {
  return {
    callId: CALL_ID,
    startedAt: STARTED_AT,
    endedAt: '2026-10-20T09:17:00Z',
    callType: 'INBOUND',
    fromNumber: '+861083550341',
    toNumber: '95001',
    ringSec: 3,
    botSec: 40,
    queueWaitSec: 12,
    talkSec: 245,
    billSec: 300,
    totalSec: 300,
    status: 'ANSWERED',
    isContained: false,
    hasRecording: false,
    legs: [{ kind: 'BOT', label: 'novanet_support', durationSec: 40 }],
  }
}

function line(seq: number, overrides: Partial<TranscriptLine> = {}): TranscriptLine {
  return {
    seq,
    occurredAt: `2026-10-20T09:12:${String(seq * 5).padStart(2, '0')}Z`,
    speaker: 'CUSTOMER',
    kind: 'TEXT',
    content: { text: 'Hello' },
    offsetMs: seq * 5000,
    source: 'MODEL',
    ...overrides,
  }
}

function renderDialog({
  transcript,
  onClose = () => {},
}: {
  transcript: TranscriptLine[]
  onClose?: () => void
}) {
  const backend = installBackend({
    handle: ({ path, method }) =>
      method === 'GET' && path === `/cdrs/${CALL_ID}`
        ? { cdr: cdr(), transcript, recordings: [] }
        : undefined,
  })
  const rendered = renderWithProviders(
    <TranscriptDialog callId={CALL_ID} onClose={onClose} />,
  )
  return { ...rendered, backend }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the transcript of one finished call', () => {
  it('shows each line with its time into the call, its speaker and its tool calls', async () => {
    renderDialog({
      transcript: [
        line(1, { content: { text: 'I was charged twice this month.' } }),
        line(2, { speaker: 'BOT', kind: 'TOOL_CALL', content: { name: 'lookup_account' } }),
        line(3, { speaker: 'BOT', kind: 'TOOL_RESULT', content: { name: 'lookup_account' } }),
      ],
    })

    expect(await screen.findByText('I was charged twice this month.')).toBeInTheDocument()
    // occurredAt - cdr.startedAt, so the reader can follow the recording.
    expect(screen.getByText('00:05')).toBeInTheDocument()
    expect(screen.getByText('00:10')).toBeInTheDocument()
    expect(screen.getByText('00:15')).toBeInTheDocument()
    expect(screen.getAllByText(i18n.t('cdr.speakers.CUSTOMER'))).toHaveLength(1)
    expect(screen.getAllByText(i18n.t('cdr.speakers.BOT'))).toHaveLength(2)
    expect(
      screen.getByText(i18n.t('cdr.toolCalled', { tool: 'lookup_account' })),
    ).toBeInTheDocument()
    expect(
      screen.getByText(i18n.t('cdr.toolAnswered', { tool: 'lookup_account' })),
    ).toBeInTheDocument()
  })

  it('says there is no transcript when the call never reached the bot', async () => {
    renderDialog({ transcript: [] })
    expect(await screen.findByText(i18n.t('cdr.noTranscript'))).toBeInTheDocument()
  })

  it('closes on Escape and on the close button', async () => {
    const onClose = vi.fn()
    const { user } = renderDialog({ transcript: [line(1)], onClose })

    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))

    await user.click(screen.getByRole('button', { name: i18n.t('common.close') }))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(2))
  })
})
