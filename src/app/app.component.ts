import {
  AfterViewInit,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  OnInit,
  ViewChild,
  inject,
  signal,
} from '@angular/core'
import { CommonModule } from '@angular/common'
import { Doom } from '../doom/doom'
import { EvType } from '../doom/doom/event'
import { ScanCode } from '../doom/interfaces/scancodes'
import { Params } from '../doom/doom/params'
import { RenderingMode } from '../doom/rendering/rendering-interface'
import { SAMPLE_RATE } from '../doom/interfaces/sound'

const DEFAULT_PARAMS = '?iwad=doom1.wad&renderer=webgl&config=modern.cfg&episode=1&map=1&skill=2&sound='

type ParamsTranslateFunc = (v: string, props: Partial<Params>) => void;

const paramsTranslates: { [k: string]: ParamsTranslateFunc } = {
  iwad: (v, props) => {
    if (v) {
      props.iwad = v
    }
  },
  renderer: (v: string, props: Partial<Params>) => {
    switch (v) {
    case 'legacy':
      props.renderingMode = RenderingMode.Legacy
      break
    case 'webgl':
      props.renderingMode = RenderingMode.WebGL
      break
    }
  },
  config: (v, props) => {
    props.config = v
  },
  episode: (v, props) => {
    if (v) {
      props.episode = parseInt(v, 10)
    }
  },
  map: (v, props) => {
    if (v) {
      props.map = parseInt(v, 10)
    }
  },
  skill: (v, props) => {
    if (v) {
      props.skill = parseInt(v, 10)
    }
  },
  noMonsters: (_, props) => {
    props.noMonsters = true
  },
  fast: (_, props) => {
    props.fast = true
  },
  respawn: (_, props) => {
    props.respawn = true
  },
  debug: (_, props) => {
    props.debug = true
  },
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [ CommonModule ],
  templateUrl: './app.component.html',
  styleUrls: [ './app.component.css' ],
})
export class AppComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('screenRoot') screenRootRef!: ElementRef<HTMLDivElement>
  @ViewChild('screen2d') screen2dRef!: ElementRef<HTMLCanvasElement>
  @ViewChild('screen3d') screen3dRef!: ElementRef<HTMLCanvasElement>

  private ngZone = inject(NgZone)

  pointerLocked = signal(false)
  altEscapeKey = signal('Backquote')

  canvasWidth = signal(window.innerWidth)
  canvasHeight = signal(window.innerHeight)

  private doom?: Doom
  private audioContext?: AudioContext

  // Designated event listener functions that can be added and removed. (We need the => function somewhere to access 'this' object.)
  private resizeHandler = () => this.onResize()
  private pointerLockChangeHandler = () => this.onPointerLockChange()
  private pointerLockErrorHandler = () => this.onBlur()

  ngOnInit(): void {
    if (typeof navigator !== 'undefined' && navigator.keyboard) {
      navigator.keyboard.getLayoutMap().then((map) => {
        this.altEscapeKey.set(map.get('Backquote') || 'Backquote')
      }).catch(() => {
        // Fallback silently if keyboard map is unavailable
      })
    }
  }

  ngAfterViewInit(): void {
    this.ngZone.runOutsideAngular(() => {
      this.initDoom()
    })

    window.addEventListener('resize', this.resizeHandler)
    // Note: Pressing the Escape key will unlock the pointer lock and trigger this function.
    document.addEventListener('pointerlockchange', this.pointerLockChangeHandler)
    document.addEventListener('pointerlockerror', this.pointerLockErrorHandler)
  }

  ngOnDestroy(): void {
    window.removeEventListener('resize', this.resizeHandler)
    document.removeEventListener('pointerlockchange', this.pointerLockChangeHandler)
    document.removeEventListener('pointerlockerror', this.pointerLockErrorHandler)

    if (this.doom) {
      this.doom.quit()
      this.doom = undefined
    }

    if (this.audioContext) {
      this.audioContext.close().catch(() => {
      })
      this.audioContext = undefined
    }
  }

  private parseParams(searchParams: URLSearchParams): Partial<Params> {
    const params: Partial<Params> = {
      iwad: 'doom1.wad',
    }

    if (typeof window !== 'undefined') {
      for (const [ key, value ] of searchParams) {
        if (key in paramsTranslates) {
          paramsTranslates[key](value, params)
        }
      }
    }

    return params
  }

  private initDoom(): void {
    const input = this.screenRootRef.nativeElement
    const screen2d = this.screen2dRef.nativeElement
    const screen3d = this.screen3dRef.nativeElement

    const searchParams = new URLSearchParams(window.location.search || DEFAULT_PARAMS)
    const params = this.parseParams(searchParams)

    this.doom = new Doom({
      ...params,
      input,
      screen2d,
      screen3d,
      iwad: params.iwad ?? 'doom1.wad',
    })

    this.doom.onError = console.error

    const hasSound = searchParams.has('sound')
    if (hasSound) {
      this.audioContext = new AudioContext({ sampleRate: SAMPLE_RATE })
      this.doom.iSound.audioCtx = this.audioContext

      // Suspend audio, if game doesn't have focus.
      if (!this.pointerLocked() && this.audioContext.state === 'running') {
        this.audioContext.suspend().catch(() => {
        })
      }
    }

    this.onResize()

    try {
      this.doom.init()
    } catch (e) {
      console.error(e)
    }
  }

  private onResize(): void {
    const width = window.innerWidth
    const height = window.innerHeight

    this.canvasWidth.set(width)
    this.canvasHeight.set(height)

    this.doom?.iVideo.setSize(width, height)
  }

  onFocus(): void {
    if (this.audioContext && this.audioContext.state === 'suspended') {
      this.audioContext.resume().catch(() => {
      })
    }

    setTimeout(() => {
      const el = this.screenRootRef.nativeElement
      el.focus()
      el.requestPointerLock()

      if (navigator.keyboard) {
        navigator.keyboard.lock()
      }
    }, 0)

    this.pointerLocked.set(true)
  }

  onBlur(): void {
    if (this.audioContext && this.audioContext.state === 'running') {
      this.audioContext.suspend().catch(() => {
      })
    }

    setTimeout(() => {
      this.screenRootRef.nativeElement.blur()
      if (navigator.keyboard) {
        navigator.keyboard.unlock()
      }
    }, 0)

    this.pointerLocked.set(false)
  }

  private onPointerLockChange(): void {
    const running = document.pointerLockElement === this.screenRootRef.nativeElement
    this.pointerLocked.set(running)

    if (running) {
      this.screenRootRef.nativeElement.focus()
    } else {
      this.doom?.postEvent({
        type: EvType.KeyDown,
        data1: ScanCode.Escape,
        data2: 0,
        data3: 0,
      })
      this.onBlur()
    }
  }
}
