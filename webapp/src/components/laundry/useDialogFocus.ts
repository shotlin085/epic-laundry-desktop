import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react'

export function useDialogFocus<D extends HTMLElement = HTMLElement, T extends HTMLElement = HTMLElement>(onClose: () => void) {
  const dialogRef = useRef<D | null>(null)
  const initialFocusRef = useRef<T | null>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const closeHandler = useRef(onClose)
  closeHandler.current = onClose

  const restoreFocus = () => {
    const previous = previousFocusRef.current
    if (!previous?.isConnected) return
    previous.focus()
    window.requestAnimationFrame(() => {
      if (previous.isConnected) previous.focus()
    })
  }

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const frame = window.requestAnimationFrame(() => (initialFocusRef.current || dialogRef.current)?.focus())
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      restoreFocus()
      closeHandler.current()
    }
    document.addEventListener('keydown', onEscape)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('keydown', onEscape)
      restoreFocus()
    }
  }, [])

  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab') return
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') || []).filter((element) => !element.hasAttribute('hidden'))
    if (!focusable.length) {
      event.preventDefault()
      dialogRef.current?.focus()
      return
    }
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (!dialogRef.current?.contains(document.activeElement)) {
      event.preventDefault()
      ;(event.shiftKey ? last : first).focus()
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return { dialogRef, initialFocusRef, onKeyDown }
}

export function useDialogFocusLifecycle(onClose: () => void, enabled: boolean) {
  const closeHandler = useRef(onClose)
  closeHandler.current = onClose

  useEffect(() => {
    if (!enabled) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const getDialog = () => Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')).at(-1)
    const getFocusable = () => Array.from(getDialog()?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') || []).filter((element) => !element.hasAttribute('hidden'))
    const frame = window.requestAnimationFrame(() => (getFocusable()[0] || getDialog())?.focus())
    const onKeyDown = (event: KeyboardEvent) => {
      const dialog = getDialog()
      if (!dialog) return
      if (event.key === 'Escape') {
        event.preventDefault()
        closeHandler.current()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = getFocusable()
      if (!focusable.length) {
        event.preventDefault()
        dialog.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!dialog.contains(document.activeElement)) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('keydown', onKeyDown)
      if (previous?.isConnected) {
        previous.focus()
        window.requestAnimationFrame(() => {
          if (previous.isConnected) previous.focus()
        })
      }
    }
  }, [enabled])
}
