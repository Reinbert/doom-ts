import { Float32BufferAttribute, Group, Mesh, MeshLambertMaterial, MixOperation, PlaneGeometry } from 'three';
import { Seg as DoomSeg } from '../../rendering/segs/seg'
import { FRACUNIT } from '../../misc/fixed';
import { Line } from '../../rendering/defs/line';
import { MapLineFlag } from '../../doom/data';
import { Sector } from '../../rendering/defs/sector';
import { SegMaterial } from '../materials/seg-material';
import { Sky } from '../../level/sky';
import { TextureLoader } from '../texture-loader';

const enum SegPart { Top, Mid, Bottom }

type SegMesh = Mesh<PlaneGeometry, SegMaterial>
type SkyMesh = Mesh<PlaneGeometry, MeshLambertMaterial>

function isSkyMesh(ceiling: SegMesh | SkyMesh): ceiling is SkyMesh {
  return !!(ceiling as SkyMesh).material.isMeshLambertMaterial
}

function segGeoFactory(): PlaneGeometry {
  const geo = new PlaneGeometry(1, 1)

  // invert uvs on the y
  const uvs = geo.attributes.uv as Float32BufferAttribute
  uvs.setXY(0, 0, 0)
  uvs.setXY(1, 1, 0)
  uvs.setXY(2, 0, 1)
  uvs.setXY(3, 1, 1)

  geo.translate(.5, .5, 0)

  return geo
}

const geo = segGeoFactory()

export class Seg extends Group {
  top?: SegMesh | SkyMesh
  mid: SegMesh
  bottom?: SegMesh

  constructor(
    private seg: DoomSeg,
    private textures: TextureLoader,
    private sky?: Sky,
  ) {
    super()

    this.add(this.mid = this.createMesh())
    if (seg.backSector) {
      if (seg.frontSector.ceilingPic === sky?.flatNum &&
        seg.backSector.ceilingPic === sky?.flatNum
      ) {
        this.add(this.top = this.createMesh(true))
      } else {
        this.add(this.top = this.createMesh())
      }
      this.add(this.bottom = this.createMesh())
    }

    this.update(seg.frontSector.lightLevel)
  }

  dispose() {
    this.mid.material.dispose()
    this.top?.material.dispose()
    this.bottom?.material.dispose()
  }

  update(lightLevel: number) {
    this.updateWallVertices()
    this.updateWallUvs()
    this.updateTextureMaps(lightLevel)
  }

  private createMesh(sky?: false): SegMesh
  private createMesh(sky: true): SkyMesh
  private createMesh(sky = false): SegMesh | SkyMesh {
    const mesh = sky ?
      new Mesh(geo, new MeshLambertMaterial({
        refractionRatio: 1,
        combine: MixOperation,
      }))
      :
      new Mesh(geo, new SegMaterial({
        paletteMap: this.textures.paletteTexture,
      }))
    mesh.visible = true

    const { seg: { v1, v2 } } = this
    const x1 = v1.x / FRACUNIT, y1 = v1.y / FRACUNIT
    const x2 = v2.x / FRACUNIT, y2 = v2.y / FRACUNIT
    const dx = x1 - x2, dy = y1 - y2

    mesh.position.z = x1
    mesh.position.x = y1
    mesh.scale.x = Math.sqrt(dx * dx + dy * dy)
    mesh.rotation.y = Math.atan2(dy, dx) + Math.PI / 2

    return mesh
  }

  private updateWallVertices(): void {
    const {
      seg: { sideDef },
      bottom, mid, top,
    } = this

    if (top) {
      this.updateHeight(top, SegPart.Top)
      top.visible = true
    }
    if (bottom) {
      this.updateHeight(bottom, SegPart.Bottom)
      bottom.visible = true
    }

    if (sideDef.midTexture) {
      this.updateHeight(mid, SegPart.Mid)
      mid.visible = true
    } else {
      mid.visible = false
    }
  }


  private getTopBottom(part: SegPart): [number, number] {
    const { backSector, frontSector } = this.seg
    if (!backSector) {
      return [ frontSector.ceilingHeight, frontSector.floorHeight ]
    }
    switch (part) {
    case SegPart.Top:
      return [ frontSector.ceilingHeight, backSector!.ceilingHeight ]
    case SegPart.Bottom:
      return [ backSector!.floorHeight, frontSector.floorHeight ]
    default:
      return [
        Math.min(frontSector.ceilingHeight, backSector.ceilingHeight),
        Math.max(frontSector.floorHeight, backSector.floorHeight),
      ]
    }
  }

  private updateHeight(mesh: Mesh, part: SegPart) {
    let [ top, bottom ] = this.getTopBottom(part)
    if (top < bottom) {
      bottom = top
    }
    top /= FRACUNIT
    bottom /= FRACUNIT

    mesh.scale.y = top - bottom
    mesh.position.y = bottom
  }

  private getMidOffset(frontSector: Sector, lineDef: Line, tex: number): number {
    if (lineDef.flags & MapLineFlag.DontPegBottom) {
      const textureHeight = this.textures.textures.getHeight(tex) / FRACUNIT
      // bottom of texture at bottom
      return frontSector.floorHeight + textureHeight - frontSector.ceilingHeight
    } else {
      // top of texture at top
      return 0
    }
  }
  private getMaskedMidOffset(frontSector: Sector, backSector: Sector, lineDef: Line, tex: number): number {
    if (lineDef.flags & MapLineFlag.DontPegBottom) {
      const textureHeight = this.textures.textures.getHeight(tex) / FRACUNIT

      return Math.max(frontSector.floorHeight, backSector.floorHeight) +
        textureHeight -
        Math.min(frontSector.ceilingHeight, backSector.ceilingHeight)
    } else {
      return 0
    }
  }
  private getTopOffset(frontSector: Sector, backSector: Sector, lineDef: Line, tex: number): number {
    // two sided line

    if (lineDef.flags & MapLineFlag.DontPegTop) {
      // top of texture at top

      // hack to allow height changes in outdoor areas
      if (frontSector.ceilingPic === this.sky?.flatNum &&
        backSector.ceilingPic === this.sky?.flatNum
      ) {
        return backSector.ceilingHeight - frontSector.ceilingHeight
      } else {
        return 0
      }

    } else {
      const textureHeight = this.textures.textures.getHeight(tex) / FRACUNIT
      // bottom of texture
      return backSector.ceilingHeight + textureHeight - frontSector.ceilingHeight
    }
  }
  private getBottomOffset(frontSector: Sector, backSector: Sector, lineDef: Line): number {
    // two sided line

    if (lineDef.flags & MapLineFlag.DontPegBottom) {
      // bottom of texture at bottom

      // hack to allow height changes in outdoor areas
      if (frontSector.ceilingPic === this.sky?.flatNum &&
        backSector.ceilingPic === this.sky?.flatNum
      ) {
        return backSector.ceilingHeight - backSector.floorHeight
      } else {
        return frontSector.ceilingHeight - backSector.floorHeight
      }
    } else {
      // top of texture at top
      return 0
    }
  }

  private updateWallUvs(): void {
    const {
      seg: { frontSector, backSector, sideDef, lineDef },
      bottom, mid, top,
    } = this

    const leftOffset = sideDef.textureOffset
    let topOffset: number

    if (!backSector) {
      topOffset = this.getMidOffset(frontSector, lineDef, sideDef.midTexture)
      topOffset += sideDef.rowOffset

      this.updateUvs(mid, leftOffset, topOffset, sideDef.midTexture)
    } else {
      if (top && !isSkyMesh(top)) {
        topOffset = this.getTopOffset(frontSector, backSector, lineDef, sideDef.topTexture)
        topOffset += sideDef.rowOffset

        this.updateUvs(top, leftOffset, topOffset, sideDef.topTexture)
      }
      if (bottom) {
        topOffset = this.getBottomOffset(frontSector, backSector, lineDef)
        topOffset += sideDef.rowOffset

        this.updateUvs(bottom, leftOffset, topOffset, sideDef.bottomTexture)
      }

      if (sideDef.midTexture) {
        topOffset = this.getMaskedMidOffset(frontSector, backSector, lineDef, sideDef.midTexture)
        topOffset += sideDef.rowOffset

        this.updateUvs(mid, leftOffset, topOffset, sideDef.midTexture)
      }
    }
  }

  private updateUvs(
    mesh: SegMesh,
    leftOffset: number,
    topOffset: number,
    tex: number,
  ): void {
    const texWidth = this.textures.textures[tex].patch.width
    const texHeight = this.textures.textures[tex].patch.height

    mesh.material.texOffset.set(
      leftOffset / FRACUNIT,
      topOffset / FRACUNIT,
    )
    mesh.material.texSize.set(texWidth, texHeight)
  }

  private updateTextureMaps(lightLevel: number): void {
    const {
      seg: { backSector, sideDef, v1, v2 },
      bottom, mid, top,
    } = this

    if (v1.y === v2.y) {
      lightLevel -= 16
    } else if (v1.x === v2.x) {
      lightLevel += 16
    }
    lightLevel = Math.max(0, Math.min(lightLevel, 255))

    this.updateTextureMap(mid, sideDef.midTexture, lightLevel);

    if (backSector) {
      if (top && isSkyMesh(top)) {
        top.material.envMap = this.textures.getSkyTexture(this.sky!.texture)
        top.material.refractionRatio = 1
        top.material.combine = MixOperation
      } else if (top) {
        this.updateTextureMap(top as SegMesh, sideDef.topTexture, lightLevel);
      }
      this.updateTextureMap(bottom, sideDef.bottomTexture, lightLevel);
    }
  }

  private updateTextureMap(
    mesh: SegMesh | undefined,
    texNum: number,
    lightLevel: number,
  ) {
    if (!mesh) {
      return
    }
    const texture = this.textures.getPatchTexture(texNum);
    mesh.material.map = texture.map;
    if (texture.transparent) {
      mesh.material.alphaMap = texture.alphaMap;
      mesh.material.transparent = true
    }
    mesh.material.lightLevel = lightLevel
  }

}
