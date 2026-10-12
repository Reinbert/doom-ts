import { LumpType } from '../wad/lump'
import { MAX_PLAYERS } from '../global/doomdef'
import { Skill } from '../doom/mode'
import { TickCmd } from '../doom/tick-cmd'

const DEMO_MARKER = 0x80

export class Demo {
  static type: LumpType = 'demo'
  static isType(buffer: ArrayBuffer): boolean {
    try {
      const d = new Demo(buffer)
      d.beginPlaying()

      return true
    } catch {
      return false
    }
  }

  private buffer: Uint8Array
  private ptr = 0

  version = 0
  old = false

  skill: Skill = 0
  episode = 0
  map = 0
  deathMatch = 0
  respawnParam = false
  fastParam = false
  noMonsters = false
  consolePlayer = 0
  playerInGame = new Array<boolean>(MAX_PLAYERS).fill(false)
  netGame = false
  netDemo = false

  constructor(arg?: ArrayBuffer) {
    if (arg) {
      this.buffer = new Uint8Array(arg)
    } else {
      this.buffer = new Uint8Array(0x20000)
    }
  }

  //
  // DEMO RECORDING
  //
  readDemoTicCmd(cmd: TickCmd): boolean {
    if (this.buffer[this.ptr] === DEMO_MARKER) {
      // end of demo data stream
      return false
    }
    cmd.forwardMove = this.buffer[this.ptr++]
    cmd.sideMove = this.buffer[this.ptr++]
    cmd.angleTurn = this.buffer[this.ptr++] << 8
    cmd.buttons = this.buffer[this.ptr++]

    return true
  }

  writeDemoTicCmd(cmd: TickCmd): void {
    this.buffer[this.ptr++] = cmd.forwardMove
    this.buffer[this.ptr++] = cmd.sideMove
    this.buffer[this.ptr++] = cmd.angleTurn + 128 >>> 8
    this.buffer[this.ptr++] = cmd.buttons

    this.ptr -= 4
    if (this.ptr > this.buffer.length - 16) {
      // no more space, increase
      const newDemo = new Uint8Array(this.buffer.length + 0x20000)
      newDemo.set(this.buffer)
      this.buffer = newDemo
    }

    // make SURE it is exactly the same
    this.readDemoTicCmd(cmd)
  }

  beginRecording(): void {
    const buffer = this.buffer
    let ptr = 0

    buffer[ptr++] = this.version
    buffer[ptr++] = this.skill
    buffer[ptr++] = this.episode
    buffer[ptr++] = this.map
    buffer[ptr++] = this.deathMatch
    buffer[ptr++] = this.respawnParam ? 1 : 0
    buffer[ptr++] = this.fastParam ? 1 : 0
    buffer[ptr++] = this.noMonsters ? 1 : 0
    buffer[ptr++] = this.consolePlayer

    for (let i = 0; i < MAX_PLAYERS; ++i) {
      buffer[ptr++] = this.playerInGame[i] ? 1 : 0
    }

    this.ptr = ptr
  }

  beginPlaying(): void {
    const buffer = this.buffer
    let ptr = 0

    this.version = buffer[ptr++]
    this.old = false
    if (this.version >= 0 && this.version <= 4) {
      this.old = true
      ptr--
    }

    this.skill = buffer[ptr++]
    this.episode = buffer[ptr++]
    this.map = buffer[ptr++]
    if (!this.old) {
      this.deathMatch = buffer[ptr++]
      this.respawnParam = !!buffer[ptr++]
      this.fastParam = !!buffer[ptr++]
      this.noMonsters = !!buffer[ptr++]
      this.consolePlayer = buffer[ptr++]
    } else {
      this.deathMatch = 0
      this.respawnParam = false
      this.fastParam = false
      this.noMonsters = false
      this.consolePlayer = 0
    }

    for (let i = 0; i < MAX_PLAYERS; ++i) {
      this.playerInGame[i] = !!buffer[ptr++]
    }
    if (this.playerInGame[1]) {
      this.netGame = true
      this.netDemo = true
    }

    this.ptr = ptr

    if (this.buffer[this.buffer.length - 1] !== DEMO_MARKER) {
      throw 'missing demo marker'
    }
  }

  archive(): ArrayBuffer {
    this.buffer[this.ptr++] = DEMO_MARKER

    return this.buffer.buffer.slice(0, this.ptr) as ArrayBuffer
  }

}
