import { Color, Palette } from './palette'
import { Video as RVideo, Screen } from '../rendering/video'
import { STRETCH } from '../global/doomdef'
import { VideoInterface } from './video-interface'

export class Video implements VideoInterface {
  width = 0
  height = 0

  private _useGamma = 0
  public get gamma(): number {
    return this._useGamma
  }
  public set gamma(value: number) {
    this._useGamma = value
    this.updatePalette()
  }

  screen: HTMLCanvasElement | null = null
  private screenCtx: CanvasRenderingContext2D | null = null

  private tmpCanvas: OffscreenCanvas | null = null
  private tmpCtx: OffscreenCanvasRenderingContext2D | null = null
  private image: ImageData | null = null

  constructor(private rVideo: RVideo) {
    this.updatePalette()
  }

  //
  // I_FinishUpdate
  //
  finishUpdate(): void {
    if (this.screen === null ||
        this.screenCtx === null ||
        this.tmpCanvas === null ||
        this.tmpCtx === null ||
        this.image === null) {
      return
    }

    this.drawInImageData(this.image.data)

    this.tmpCtx.putImageData(this.image, 0, 0)

    this.screenCtx.imageSmoothingEnabled = false

    const destWidth = this.screen.width
    const destHeight = this.screen.height

    const sourceRatio = this.rVideo.width / this.rVideo.height
    const destRatio = destWidth / destHeight

    let scaledWidth;
    let scaledHeight;
    if (sourceRatio > destRatio) {
      scaledWidth = destWidth;
      scaledHeight = destWidth / sourceRatio;
    } else {
      scaledHeight = destHeight;
      scaledWidth = destHeight * sourceRatio;
    }

    const x = (destWidth - scaledWidth) / 2;
    const y = (destHeight - scaledHeight) / 2;

    this.screenCtx.drawImage(this.tmpCanvas,
      x, y, scaledWidth, scaledHeight)
  }

  drawInImageData(oLine: Uint8ClampedArray, withAlpha = true): void {
    const iLine = new Uint8ClampedArray(this.rVideo.screens[0].buffer)
    const alpha = this.rVideo.screens[0].alpha

    let oLinePtr = 0
    let iLinePtr = 0
    let x: number
    let y = this.rVideo.height

    const reds = this.reds
    const greens = this.greens
    const blues = this.blues
    while (y--) {
      x = this.rVideo.width
      do {
        oLine[oLinePtr++] = reds[iLine[iLinePtr]]
        oLine[oLinePtr++] = greens[iLine[iLinePtr]]
        oLine[oLinePtr++] = blues[iLine[iLinePtr]]
        if (withAlpha) {
          oLine[oLinePtr++] = alpha[iLinePtr]
        }
        iLinePtr++
      // eslint-disable-next-line no-cond-assign
      } while (x -= 1)
    }
  }

  private _palette = new Palette()
  public get palette(): Palette {
    return this._palette
  }
  public set palette(p: Palette) {
    this._palette = p
    this.updatePalette()
  }
  private reds = new Uint8ClampedArray()
  private greens = new Uint8ClampedArray()
  private blues = new Uint8ClampedArray()

  private updatePalette(): void {
    this.reds = this.palette.getColors(Color.Red, this.gamma) as any
    this.greens = this.palette.getColors(Color.Green, this.gamma) as any
    this.blues = this.palette.getColors(Color.Blue, this.gamma) as any
  }

  private firstTime = true

  init(): void {
    if (!this.firstTime) {
      return
    }
    if (this.screen === null) {
      throw 'no screen defined'
    }
    this.firstTime = false

    const { width, height } = this.rVideo
    const tmpCanvas = new OffscreenCanvas(width, height)
    const tmpCtx = tmpCanvas.getContext('2d')
    const screenCtx = this.screen.getContext('2d')
    if (tmpCtx === null || screenCtx === null) {
      throw 'Could not open display'
    }
    this.tmpCanvas = tmpCanvas
    this.tmpCtx = tmpCtx
    this.screenCtx = screenCtx

    this.image = tmpCtx.createImageData(width, height)

    this.rVideo.screens[0] = new Screen(width, height)
  }

  setSize(width: number, height: number): void {
    if (this.screen === null) {
      throw 'no screen defined'
    }
    this.width = width
    this.height = height

    this.screen.width = width;
    this.screen.height = height / STRETCH;
  }

  quit(): void {
    if (this.screen === null || this.screenCtx === null) {
      return
    }

    this.screenCtx.clearRect(0, 0, this.width, this.height)

    this.screenCtx = null
  }
}
