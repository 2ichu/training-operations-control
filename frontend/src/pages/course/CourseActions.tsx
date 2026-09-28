import { type FormEvent, useState } from 'react'
import { ApiError, api } from '../../api/client'
import type { ClosureItem, CourseDetail } from '../../api/types'
import { useApi } from '../../api/useApi'
import { ErrorText } from '../../components/Feedback'
import { Modal } from '../../components/Modal'
import { ClosureChecklistTable } from './ClosureChecklist'
import { blockingOf, warningsOf } from './course-model'

type Action = 'open-recruitment' | 'start' | 'suspend' | 'close'

// baseline 3-1 전이표: 현재 상태에서 가능한 전환만 버튼으로 보여준다(종료·중단은 최종 상태라 버튼 없음)
const ACTIONS: Record<string, { action: Action; label: string }[]> = {
  PREPARING: [
    { action: 'open-recruitment', label: '모집 시작' },
    { action: 'start', label: '운영중 전환' },
    { action: 'suspend', label: '중단 처리' },
  ],
  RECRUITING: [
    { action: 'start', label: '운영중 전환' },
    { action: 'suspend', label: '중단 처리' },
  ],
  IN_PROGRESS: [
    { action: 'close', label: '종료 처리' },
    { action: 'suspend', label: '중단 처리' },
  ],
}

export function CourseActions({ course, onChanged }: { course: CourseDetail; onChanged: () => void }) {
  const [open, setOpen] = useState<Action | null>(null)
  const actions = ACTIONS[course.status] ?? []
  if (actions.length === 0) return null
  const done = () => {
    setOpen(null)
    onChanged()
  }
  return (
    <>
      {actions.map((a) => (
        <button key={a.action} type="button" onClick={() => setOpen(a.action)}>
          {a.label}
        </button>
      ))}
      {open === 'open-recruitment' && <SimpleConfirm course={course} onClose={() => setOpen(null)} onDone={done} />}
      {open === 'start' && <StartDialog course={course} onClose={() => setOpen(null)} onDone={done} />}
      {open === 'suspend' && <SuspendDialog course={course} onClose={() => setOpen(null)} onDone={done} />}
      {open === 'close' && <CloseDialog course={course} onClose={() => setOpen(null)} onDone={done} />}
    </>
  )
}

interface DialogProps {
  course: CourseDetail
  onClose: () => void
  onDone: () => void
}

function useSubmit(onDone: () => void) {
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const run = async (fn: () => Promise<unknown>, onApiError?: (e: ApiError) => boolean) => {
    setSubmitting(true)
    setError(null)
    try {
      await fn()
      onDone()
    } catch (e) {
      if (e instanceof ApiError && onApiError?.(e)) return
      setError(e instanceof ApiError ? e.message : '처리하지 못했습니다.')
    } finally {
      setSubmitting(false)
    }
  }
  return { error, submitting, run }
}

function Actions({ submitting, label, onClose, disabled }: { submitting: boolean; label: string; onClose: () => void; disabled?: boolean }) {
  return (
    <div className="form-actions">
      <button type="submit" className="button-primary" disabled={submitting || disabled}>
        {submitting ? '처리 중…' : label}
      </button>
      <button type="button" onClick={onClose}>
        취소
      </button>
    </div>
  )
}

function FormError({ error }: { error: string | null }) {
  return error ? (
    <p className="form-error" role="alert">
      {error}
    </p>
  ) : null
}

function SimpleConfirm({ course, onClose, onDone }: DialogProps) {
  const { error, submitting, run } = useSubmit(onDone)
  return (
    <Modal title="모집 시작" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void run(() => api.post(`/courses/${course.courseId}/open-recruitment`))
        }}
      >
        <p>「{course.courseName}」을(를) 모집중으로 전환합니다.</p>
        <FormError error={error} />
        <Actions submitting={submitting} label="모집 시작" onClose={onClose} />
      </form>
    </Modal>
  )
}

// 확정 훈련생이 0명이면 서버가 409(NO_CONFIRMED_TRAINEES)로 한 번 막는다 — 경고를 보여주고 확인하면 다시 보낸다(system-design S16 예외 상황)
function StartDialog({ course, onClose, onDone }: DialogProps) {
  const { error, submitting, run } = useSubmit(onDone)
  const [needsAck, setNeedsAck] = useState(false)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    void run(
      () => api.post(`/courses/${course.courseId}/start`, needsAck ? { acknowledge_no_confirmed_trainees: true } : {}),
      (e) => {
        if (e.code !== 'NO_CONFIRMED_TRAINEES') return false
        setNeedsAck(true)
        return true
      },
    )
  }
  return (
    <Modal title="운영중 전환" onClose={onClose}>
      <form onSubmit={submit}>
        {needsAck ? (
          <p className="notice" role="alert">
            확정 훈련생이 없습니다. 그래도 운영중으로 전환하려면 다시 확인해 주세요.
          </p>
        ) : (
          <p>「{course.courseName}」을(를) 운영중으로 전환합니다.</p>
        )}
        <FormError error={error} />
        <Actions submitting={submitting} label={needsAck ? '확정 훈련생 없이 전환' : '운영중 전환'} onClose={onClose} />
      </form>
    </Modal>
  )
}

function SuspendDialog({ course, onClose, onDone }: DialogProps) {
  const { error, submitting, run } = useSubmit(onDone)
  const [reason, setReason] = useState('')
  const [missing, setMissing] = useState(false)
  return (
    <Modal title="중단 처리" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!reason.trim()) return setMissing(true)
          void run(() => api.post(`/courses/${course.courseId}/suspend`, { reason: reason.trim() }))
        }}
        noValidate
      >
        <p>중단은 되돌릴 수 없는 최종 상태이며, 이후 이 과정의 훈련생·일정·출결 등은 변경할 수 없습니다.</p>
        <label className="stacked">
          중단 사유(필수)
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={3} />
        </label>
        {missing && !reason.trim() && <FormError error="중단 사유를 입력해 주세요." />}
        <FormError error={error} />
        <Actions submitting={submitting} label="중단 처리" onClose={onClose} />
      </form>
    </Modal>
  )
}

// 종료: 체크리스트를 다시 불러와 필수 차단이 있으면 막고, 경고가 있으면 강행 사유를 받는다(baseline 9절·D-06, OPS 단독)
function CloseDialog({ course, onClose, onDone }: DialogProps) {
  const { error, submitting, run } = useSubmit(onDone)
  const checklist = useApi((signal) => api.get<{ items: ClosureItem[] }>(`/courses/${course.courseId}/closure-checklist`, undefined, signal), 'close')
  const [reason, setReason] = useState('')
  const [missing, setMissing] = useState(false)
  const items = checklist.data?.items ?? []
  const blocking = blockingOf(items)
  const warnings = warningsOf(items)

  return (
    <Modal title="종료 처리" onClose={onClose}>
      {checklist.status === 'error' && <ErrorText error={checklist.error} onRetry={checklist.reload} />}
      {!checklist.data && checklist.status === 'loading' && <p className="muted">체크리스트를 확인하는 중…</p>}
      {checklist.data && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (warnings.length > 0 && !reason.trim()) return setMissing(true)
            void run(() => api.post(`/courses/${course.courseId}/close`, warnings.length > 0 ? { override_reason: reason.trim() } : {}), (e) => {
              // 그 사이 상황이 바뀌어 차단·경고가 생겼으면 체크리스트를 다시 불러온다
              if (e.code === 'CLOSURE_BLOCKED' || e.field === 'override_reason') checklist.reload()
              return false
            })
          }}
          noValidate
        >
          <ClosureChecklistTable items={items} courseId={course.courseId} />
          {blocking.length > 0 ? (
            <p className="form-error" role="alert">
              필수 차단 항목({blocking.map((i) => i.label).join(', ')})이 남아 있어 종료할 수 없습니다. 해당 항목을 먼저 처리해 주세요.
            </p>
          ) : warnings.length > 0 ? (
            <label className="stacked">
              경고 항목이 있습니다. 종료를 진행하려면 사유를 입력해 주세요(감사로그에 기록됩니다).
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={3} />
            </label>
          ) : (
            <p>확인이 필요한 항목이 없습니다. 종료는 되돌릴 수 없습니다.</p>
          )}
          {missing && warnings.length > 0 && !reason.trim() && <FormError error="종료 사유를 입력해 주세요." />}
          <FormError error={error} />
          <Actions submitting={submitting} label={blocking.length === 0 && warnings.length > 0 ? '사유를 남기고 종료' : '종료'} onClose={onClose} disabled={blocking.length > 0} />
        </form>
      )}
    </Modal>
  )
}
