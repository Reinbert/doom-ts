import { LumpType } from '../wad/lump'

export class ColorMaps {
  static readonly DEFAULT_LUMP = 'COLORMAP'
  static readonly type: LumpType = 'colormaps'
  static isType(_: ArrayBuffer, name: string): boolean {
    return name === ColorMaps.DEFAULT_LUMP
  }

  c: ColorMap[] = [
    new ColorMap(),
  ]

  constructor(buffer?: ArrayBuffer) {
    if (buffer) {
      const size = buffer.byteLength / 256

      for (let i = 0; i < size; ++i) {
        this.c[i] = new Uint8ClampedArray(buffer.slice(i * 256, (i+1) * 256))
      }
    }
  }
}

export class ColorMap extends Uint8ClampedArray {
  constructor(array?: ArrayLike<number> | ArrayBufferLike) {
    if (!array) {
      array = Array.from({ length: 256 }, (_, i) => i)
    }
    super(array as any)
  }
}
