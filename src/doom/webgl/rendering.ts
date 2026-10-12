import { Controller, GUI } from 'lil-gui'
import {
  Group,
  PerspectiveCamera,
  Vector4,
} from 'three'
import { BSP } from './bsp'
import { Doom } from '../doom'
import { FRACUNIT } from '../misc/fixed'
import { Rendering as LegacyRendering } from '../rendering/rendering'
import { Level } from '../level/level'
import { LevelGroup } from './objects/level'
import { Player } from '../doom/player'
import { Segs } from './segs'
import { TextureLoader } from './texture-loader'
import { Things } from './things'
import { Video } from './video'
import { toRad } from '../misc/table'

export class Rendering extends LegacyRendering {

  private camera = new PerspectiveCamera(
    64, 320 / 200, 10, 4000,
  )
  private cameraFovController: Controller | null = null
  private cameraGui: GUI | null = null
  private viewport = new Vector4()

  public pSpritesGroup: Group

  private currentLevel: Level | null = null
  levelGroup: LevelGroup | null = null

  textures: TextureLoader
  declare things: Things

  constructor(doom: Doom, public iVideo: Video) {
    super(doom)

    this.textures = new TextureLoader()
    this.textures.flats = this.data.flats
    this.textures.sprites = this.data.sprites
    this.textures.spriteDefs = this.data.spriteDefs
    this.textures.textures = this.data.textures
    this.textures.paletteTexture.palette = iVideo.palette

    this.bsp = new BSP(this)
    this.segs = new Segs(this)
    this.things = new Things(this, this.video.width)

    iVideo.camera = this.camera
    iVideo.viewport = this.viewport
    this.pSpritesGroup = iVideo.pSpritesGroup

    if (doom.gui) {
      this.cameraGui = doom.gui.addFolder('Camera').open(false)

      this.cameraFovController = this.cameraGui.add(this.camera, 'fov')
        .min(1).max(180)
        .onChange(() => this.camera.updateProjectionMatrix())

      this.cameraGui.add(this.camera, 'near')
        .min(0.1).max(100).step(1)
        .onChange(() => this.camera.updateProjectionMatrix())
      this.cameraGui.add(this.camera, 'far')
        .min(100).max(5000).step(1)
        .onChange(() => this.camera.updateProjectionMatrix())
    }
  }

  private setupLevel(level: Level): void {
    if (this.levelGroup) {
      this.levelGroup.removeFromParent()
      this.levelGroup.dispose()
    }

    this.levelGroup = new LevelGroup(level, this.textures)

    this.iVideo.scene.add(this.levelGroup)
  }

  protected setupFrame(player: Player): void {
    this.textures.paletteTexture.palette = this.iVideo.palette
    this.textures.paletteTexture.colorMap = this.fixedColorMap || this.data.colorMaps.c[0]

    if (this.currentLevel !== this.level) {
      this.setupLevel(this.level)
      this.currentLevel = this.level
    }

    super.setupFrame(player)

    // axis are y, z, x
    this.camera.position.set(
      this.viewY / FRACUNIT,
      this.viewZ / FRACUNIT,
      this.viewX / FRACUNIT,
    )

    this.camera.rotation.y = toRad(this.viewAngle) + Math.PI
  }

  renderPlayerView(pl: Player): void {
    this.levelGroup?.reset()

    super.renderPlayerView(pl)

    this.setAlphaScreen()
  }


  setAlphaScreen(): void {
    const screen = this.video.screens[0]
    const alpha = screen.alpha
    alpha.fill(255)

    const top = this.viewWindowY
    const bottom = top + this.viewHeight
    const left = this.viewWindowX
    const right = left + this.viewWidth

    for (let y = top; y < bottom; ++y) {
      const offset = screen.width * y;
      alpha.fill(0, left + offset, right + offset)
    }
  }

  executeSetViewSize(): void {
    super.executeSetViewSize()

    // viewport is from bottom to top
    this.camera.aspect = this.viewWidth / this.viewHeight
    this.camera.fov = this.fullScreen ? 64 : 54
    this.camera.updateProjectionMatrix()
    this.cameraFovController?.updateDisplay()

    this.viewport.set(
      this.viewWindowX,
      this.video.height - this.viewWindowY - this.viewHeight,
      this.viewWidth,
      this.viewHeight)

    this.iVideo.setSize()
  }
}
