
import { RenderingInterface, RenderingMode } from '../rendering/rendering-interface'
import { Sound as DSound } from '../doom/sound'
import { Doom } from '../doom'
import { Game } from '../game/game'
import { HeadsUp } from '../heads-up/stuff'
import { Input } from '../interfaces/input'
import { ScanCode } from '../interfaces/scancodes'
import { VideoInterface } from '../interfaces/video-interface'
import { fs } from '../system/fs'

const defaultCfg = 'default.cfg'

interface GetSet<T> {
  get: () => T | null | undefined
  set: (v: T) => void
}

export class AgnosticDefaults {
  defaults: {[k: string]: number | GetSet<number>} = {
    mouse_sensitivity: 5,
    sfx_volume: 8,
    music_volume: 8,
    show_messages: 1,

    key_right: ScanCode.ArrowRight,
    key_left: ScanCode.ArrowLeft,
    key_up: ScanCode.ArrowUp,
    key_down: ScanCode.ArrowDown,
    key_strafeleft: ScanCode.Comma,
    key_straferight: ScanCode.Period,
    key_fire: ScanCode.ControlLeft,
    key_use: ScanCode.Space,
    key_strafe: ScanCode.AltLeft,
    key_speed: ScanCode.ShiftRight,

    use_mouse: 1,
    mouseb_fire: 0,
    mouseb_strafe: 1,
    mouseb_forward: 2,

    use_joystick: 0,
    joyb_fire: 0,
    joyb_strafe: 1,
    joyb_use: 3,
    joyb_speed: 2,

    screenblocks: 9,
    detaillevel: 0,
    snd_channels: 3,
    usegamma: 0,

    resolution_width: 320,
    resolution_height: 240,
    resolution_scale: 1,
    rendering_mode: RenderingMode.Legacy,
  }

  private configFile: string = defaultCfg

  async save(): Promise<unknown> {
    const lines = Object.keys(this.defaults).map(name => {
      const value = this.get(name)
      return typeof value === 'number' ? `${name} ${value}` : undefined
    }).filter(line => !!line)

    const te = new TextEncoder()
    const buffer = te.encode(lines.join('\n'))

    return await fs.write(this.configFile, buffer.buffer as ArrayBuffer)
  }

  async load(configFile?: string): Promise<void> {
    this.configFile = configFile || defaultCfg

    const file = await fs.open(this.configFile)

    if (file) {
      const td = new TextDecoder()
      const fileContent = td.decode(file)

      const matches = fileContent.matchAll(/([^ ]{1,79}) ([^\n]*)(\n|$)/g)
      let name: string
      let param: string
      let value: number
      for ([ , name, param ] of matches) {
        if (param.startsWith('"')) {
          value = param.charCodeAt(1)
        } else if (param.startsWith('0x')) {
          value = parseInt(param, 16)
        } else {
          value = parseInt(param, 10)
        }

        if (!isNaN(value)) {
          this.set(name, value)
        }
      }
    }
  }

  get(name: string): number | null | undefined {
    const def = this.defaults[name]

    if (def !== undefined && typeof def === 'object') {
      return def.get()
    } else {
      return def as number | null | undefined
    }
  }
  set(name: string, value: number): void {
    const def = this.defaults[name]
    if (def !== undefined && typeof def === 'object') {
      def.set(value)
    } else {
      this.defaults[name] = value
    }
  }
}

export class Defaults extends AgnosticDefaults {
  defaults: {[k: string]: number | GetSet<number>} = {
    mouse_sensitivity: {
      get: () => this.game.mouseSensitivity,
      set: v => this.game.mouseSensitivity = v,
    },
    sfx_volume: {
      get: () => this.dSound.sfxVolume,
      set: v => this.dSound.sfxVolume = v,
    },
    music_volume: {
      get: () => this.dSound.musicVolume,
      set: v => this.dSound.musicVolume = v,
    },
    show_messages: {
      get: () => this.headsUp.showMessages ? 1 : 0,
      set: v => this.headsUp.showMessages = !!v,
    },

    key_right: {
      get: () => this.game.keyRight,
      set: v => this.game.keyRight = v,
    },
    key_left: {
      get: () => this.game.keyLeft,
      set: v => this.game.keyLeft = v,
    },
    key_up: {
      get: () => this.game.keyUp,
      set: v => this.game.keyUp = v,
    },
    key_down: {
      get: () => this.game.keyDown,
      set: v => this.game.keyDown = v,
    },
    key_strafeleft: {
      get: () => this.game.keyStrafeLeft,
      set: v => this.game.keyStrafeLeft = v,
    },
    key_straferight: {
      get: () => this.game.keyStrafeRight,
      set: v => this.game.keyStrafeRight = v,
    },
    key_fire: {
      get: () => this.game.keyFire,
      set: v => this.game.keyFire = v,
    },
    key_use: {
      get: () => this.game.keyUse,
      set: v => this.game.keyUse = v,
    },
    key_strafe: {
      get: () => this.game.keyStrafe,
      set: v => this.game.keyStrafe = v,
    },
    key_speed: {
      get: () => this.game.keySpeed,
      set: v => this.game.keySpeed = v,
    },

    use_mouse: {
      get: () => this.input.useMouse ? 1 : 0,
      set: v => this.input.useMouse = !!v,
    },
    mouseb_fire: {
      get: () => this.game.mouseBFire,
      set: v => this.game.mouseBFire = v,
    },
    mouseb_strafe: {
      get: () => this.game.mouseBStrafe,
      set: v => this.game.mouseBStrafe = v,
    },
    mouseb_forward: {
      get: () => this.game.mouseBForward,
      set: v => this.game.mouseBForward = v,
    },

    use_joystick: {
      get: () => this.input.useJoystick ? 1 : 0,
      set: v => this.input.useJoystick = !!v,
    },
    joyb_fire: {
      get: () => this.game.joyBFire,
      set: v => this.game.joyBFire = v,
    },
    joyb_strafe: {
      get: () => this.game.joyBStrafe,
      set: v => this.game.joyBStrafe = v,
    },
    joyb_use: {
      get: () => this.game.joyBUse,
      set: v => this.game.joyBUse = v,
    },
    joyb_speed: {
      get: () => this.game.joyBSpeed,
      set: v => this.game.joyBSpeed = v,
    },

    screenblocks: {
      get: () => this.rendering.screenSize + 3,
      set: v => this.rendering.screenSize = v - 3,
    },
    detaillevel: {
      get: () => this.rendering.highDetails ? 1 : 0,
      set: v => this.rendering.highDetails = !!v,
    },
    snd_channels: {
      get: () => this.dSound.numChannels,
      set: v => this.dSound.numChannels = v,
    },
    usegamma: {
      get: () => this.iVideo.gamma,
      set: v => this.iVideo.gamma = v,
    },
    resolution_width: {
      get: () => this.doom.rVideo.physicalWidth,
      set: v => this.doom.rVideo.physicalWidth = v,
    },
    resolution_height: {
      get: () => this.doom.rVideo.physicalHeight,
      set: v => this.doom.rVideo.physicalHeight = v,
    },
    resolution_scale: {
      get: () => this.doom.rVideo.scale,
      set: v => this.doom.rVideo.scale = v,
    },
    rendering_mode: {
      get: () => this.doom.renderingMode,
      set: v => this.doom.renderingMode = v,
    },
  }

  private get dSound(): DSound {
    return this.doom.dSound
  }
  private get game(): Game {
    return this.doom.game
  }
  private get headsUp(): HeadsUp {
    return this.doom.headsUp
  }
  private get input(): Input {
    return this.doom.input
  }
  private get iVideo(): VideoInterface {
    return this.doom.iVideo
  }
  private get rendering(): RenderingInterface {
    return this.doom.rendering
  }

  constructor(private doom: Doom) {
    super()
  }
}
