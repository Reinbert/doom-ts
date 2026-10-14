export type XEvent = KeyboardEvent | MouseEvent

export const Button1Mask = 0x1
export const Button2Mask = 0x2
export const Button3Mask = 0x4

interface ScreenListener {
  pending: XEvent[],
  listeners: {
    [K in keyof HTMLElementEventMap]?: (this: HTMLElement, ev: HTMLElementEventMap[K]) => unknown
  },
}
const listeners = new Map<HTMLElement, ScreenListener>()

export function XPending(display: HTMLElement): number {
  const l = listeners.get(display)
  return l === void 0 ? 0 : l.pending.length
}

export function XNextEvent(display: HTMLElement): XEvent | never {
  for (;;) {
    const l = listeners.get(display)
    if (l !== undefined && l.pending.length > 0) {
      return l.pending.shift() as XEvent
    }
  }
}

export function XListenEvent(display: HTMLElement, mouse: boolean): void {
  const l: ScreenListener = { pending: [], listeners: {} }
  const pending = l.pending
  listeners.set(display, l)
  display.tabIndex = 0

  const preventDefault = (ev: Event) => ev.preventDefault()
  const listener = (ev: XEvent): void => {
    pending.push(ev) && ev.preventDefault()
  }

  if (mouse) {
    display.addEventListener('contextmenu', preventDefault)
    l.listeners.contextmenu = preventDefault
  }

  const onFocus = () => {
    display.addEventListener('keydown', listener)
    l.listeners.keydown = listener
    display.addEventListener('keyup', listener)
    l.listeners.keyup = listener
    if (mouse) {
      display.addEventListener('mousedown', listener)
      l.listeners.mousedown = listener
      display.addEventListener('mouseup', listener)
      l.listeners.mouseup = listener
      display.addEventListener('mousemove', listener)
      l.listeners.mousemove = listener
    }
  }

  const onBlur = () => {
    display.removeEventListener('keydown', listener)
    delete l.listeners.keydown
    display.removeEventListener('keyup', listener)
    delete l.listeners.keyup
    if (mouse) {
      display.removeEventListener('mousedown', listener)
      delete l.listeners.mousedown
      display.removeEventListener('mouseup', listener)
      delete l.listeners.mouseup
      display.removeEventListener('mousemove', listener)
      delete l.listeners.mousemove
    }
  }

  display.addEventListener('focus', onFocus)
  l.listeners.focus = onFocus
  display.addEventListener('blur', onBlur)
  l.listeners.blur = onBlur
}

export function XQuitEvent(display: HTMLElement): void {
  if (document.fullscreenElement === display.parentElement) {
    document.exitFullscreen()
  }

  const l = listeners.get(display)
  if (l === undefined) {
    return
  }

  l.pending = [];

  (Object.keys(l.listeners) as (keyof HTMLElementEventMap)[])
    .forEach(k => {
      display.removeEventListener(k, l.listeners[k] as never)
    })
}
