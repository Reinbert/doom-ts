import { DataTexture, NearestFilter, RedFormat, RepeatWrapping } from 'three'
import { Patch } from '../../rendering/defs/patch'
import { Video as RVideo } from '../../rendering/video'

export class PatchTexture extends DataTexture {
  constructor(patch: Patch, alphaMap = false) {
    const rVideo = new RVideo({ logical: [ patch.width, patch.height ] })
    rVideo.init(1)
    rVideo.drawPatch(patch.leftOffset, patch.topOffset, 0, patch)

    const source = rVideo.screens[0]
    super((alphaMap ? source.alpha : source) as unknown as BufferSource, patch.width, patch.height, RedFormat)

    this.flipY = true

    this.wrapS = RepeatWrapping
    this.wrapT = RepeatWrapping

    this.magFilter = NearestFilter
  }
}
