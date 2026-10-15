import { AmmoType, ArmorType, Card, GameState, MAX_PLAYERS, PowerType, TICRATE, WeaponType } from '../global/doomdef'
import { ButtonCode, DEvent, EvType, GameAction } from '../doom/event'
import { Cheat, Player, PlayerState, WbStart } from '../doom/player'
import { FRACBITS, FRACUNIT } from '../misc/fixed'
import { GameMode, GameVersion, Skill } from '../doom/mode'
import { SKY_FLAT_NAME, Sky } from '../level/sky'
import { fromDeg, toDeg } from '../misc/table'
import { AutoMap } from '../auto-map/auto-map'
import { BACKUP_TICS } from '../doom/net/doom-data'
import { Sound as DSound } from '../doom/sound'
import { Demo } from './demo'
import { Doom } from '../doom'
import { Finale } from '../finale/finale'
import { GUI } from 'lil-gui'
import { HeadsUp } from '../heads-up/stuff'
import { LumpReader } from '../wad/lump-reader'
import { MAX_HEALTH } from '../play/local'
import { MObjFlag } from '../play/mobj/mobj-flag'
import { MObjType } from '../doom/info/mobj-type'
import { Menu } from '../menu/menu'
import { Net } from '../doom/net'
import { Play } from '../play/setup'
import { Data as RData } from '../rendering/data'
import { RenderingInterface } from '../rendering/rendering-interface'
import { SaveGame } from '../play/save-game'
import { ScanCode } from '../interfaces/scancodes'
import { StateNum } from '../doom/info/state-num'
import { StatusBar } from '../status/stuff'
import { Tick } from '../play/tick'
import { TickCmd } from '../doom/tick-cmd'
import { Win } from '../win/win'
import { fs } from '../system/fs'
import { getTime } from '../system/system'
import { mObjInfos } from '../doom/info/mobj-infos'
import { maxAmmo } from '../play/inter'
import { random } from '../misc/random'
import { states } from '../doom/info/states'
import { tostring } from '../utils/c'

const MAX_PL_MOVE = 0x32

const SLOW_TURN_TICS = 6

const NUM_KEYS = 256

// DOOM Par Times
const pars = [
  [ 0 ],
  [ 0, 30, 75, 120, 90, 165, 180, 180, 30, 165 ],
  [ 0, 90, 90, 90, 120, 90, 360, 240, 30, 170 ],
  [ 0, 90, 45, 90, 150, 90, 90, 165, 30, 135 ],
]

// DOOM II Par Times
const cPars = [
  //  1-10
  30, 90, 120, 120, 90, 150, 120, 120, 270, 90,
  // 11-20
  210, 150, 150, 150, 210, 150, 420, 150, 210, 150,
  // 21-30
  240, 150, 180, 150, 150, 300, 330, 420, 300, 180,
  // 31-32
  120, 30,
]

export const SAVE_GAME_NAME = 'doomsav'
const SAVE_GAME_SIZE = 0x2c000
export const SAVE_STRING_SIZE = 24
const VERSION_SIZE = 16

export class Game {
  gameAction = GameAction.Nothing
  gameState: GameState = -1
  gameSkill: Skill = -1
  respawnMonsters = false
  gameEpisode = -1
  gameMap = -1

  paused = false
  // send a pause event next tic
  private sendPause = false
  // send a save event next tic
  private sendSave = false
  // ok to save / end game
  userGame = false

  // if true, exit with report on completion
  private timingDemo = false
  // for comparative timing purposes
  noDrawers = false

  // for comparative timing purposes
  private startTime = -1

  viewActive = false

  // only if started as net death
  deathMatch = 0
  // only true if packets are broadcast
  netGame = false
  playerInGame = new Array<boolean>(MAX_PLAYERS).fill(false)
  players = Array.from({ length: MAX_PLAYERS }, () => new Player())

  get player(): Player {
    return this.players[this.consolePlayer]
  }

  // player taking events and displaying
  consolePlayer = 0
  // view being displayed
  displayPlayer = 0
  gameTic = 0
  // for intermission
  totalKills = 0
  totalItems = 0
  totalSecret = 0

  private demoName = ''
  demoRecording = false
  demoPlayback = false
  private demo = new Demo()
  // quit after playing a demo from cmdline
  singleDemo = false

  // parms for world map / intermission
  private wmInfo = new WbStart()

  private consistancy = Array.from({ length: MAX_PLAYERS },
    () => new Array<number>(BACKUP_TICS).fill(0))

  //
  // controls (have defaults)
  //
  keyRight = ScanCode.ArrowRight
  keyLeft = ScanCode.ArrowLeft
  keyUp = ScanCode.ArrowUp
  keyDown = ScanCode.ArrowDown
  keyStrafeLeft = ScanCode.Comma
  keyStrafeRight = ScanCode.Period
  keyFire = ScanCode.ControlLeft
  keyUse = ScanCode.Space
  keyStrafe = ScanCode.AltLeft
  keySpeed = ScanCode.ShiftRight

  mouseBFire = 0
  mouseBStrafe = 1
  mouseBForward = 2

  joyBFire = 0
  joyBStrafe = 1
  joyBUse = 3
  joyBSpeed = 2

  private forwardMove = [ 0x19, 0x32 ]
  private sideMove = [ 0x18, 0x28 ]
  // + slow turn
  private angleTurn = [ 640, 1280, 320 ]

  private gameKeyDown = new Array<boolean>(NUM_KEYS).fill(false)
  // for accelerative turning
  private turnHeld = 0

  // allow [-1]
  private mouseButtons = new Array<boolean>(3).fill(false)

  // mouse values are used once
  private mouseX = -1
  private mouseY = -1

  private dClickTime = 0
  private dClickState = false
  private dClicks = 0

  // joystick values are repeated
  private joyXMove = -1
  private joyYMove = -1

  // allow [-1]
  private joyButtons = new Array<boolean>(4).fill(false)

  private saveGameSlot = 0
  private saveDescription = ''

  bodyQueSlot = -1

  mouseSensitivity = 5

  private get autoMap(): AutoMap {
    return this.doom.autoMap
  }

  private get dSound(): DSound {
    return this.doom.dSound
  }

  private get finale(): Finale {
    return this.doom.finale
  }

  private get headsUp(): HeadsUp {
    return this.doom.headsUp
  }

  private get inter() {
    return this.play.inter
  }

  private get menu(): Menu {
    return this.doom.menu
  }

  private get net(): Net {
    return this.doom.net
  }

  private get play(): Play {
    return this.doom.play
  }

  private get rData(): RData {
    return this.doom.rData
  }

  private get rendering(): RenderingInterface {
    return this.doom.rendering
  }

  private get saveGame(): SaveGame {
    return this.play.saveGame
  }

  private get statusBar(): StatusBar {
    return this.doom.statusBar
  }

  private get tick(): Tick {
    return this.play.tick
  }

  private get wad(): LumpReader {
    return this.doom.wad
  }

  private get win(): Win {
    return this.doom.win
  }

  constructor(private doom: Doom) {
  }

  //
  // G_BuildTiccmd
  // Builds a ticcmd from all of the available inputs
  // or reads it from the demo buffer.
  // If recording a demo, write it out
  //
  buildTicCmd(cmd: TickCmd): void {
    // empty, or external driver
    cmd.reset()

    cmd.consistancy = this.consistancy[this.consolePlayer][this.net.makeTic % BACKUP_TICS]

    const strafe = this.gameKeyDown[this.keyStrafe] || this.mouseButtons[this.mouseBStrafe] || this.joyButtons[this.joyBStrafe]
    const speed = this.gameKeyDown[this.keySpeed] || this.joyButtons[this.joyBSpeed] ? 1 : 0

    let forward = 0
    let side = 0

    // use two stage accelerative turning
    // on the keyboard and joystick
    if (this.joyXMove < 0 || this.joyXMove > 0 || this.gameKeyDown[this.keyRight] || this.gameKeyDown[this.keyLeft]) {
      this.turnHeld += this.net.ticDup
    } else {
      this.turnHeld = 0
    }

    let tSpeed: number
    if (this.turnHeld < SLOW_TURN_TICS) {
      // slow turn
      tSpeed = 2
    } else {
      tSpeed = speed
    }

    // let movement keys cancel each other out
    if (strafe) {
      if (this.gameKeyDown[this.keyRight]) {
        side += this.sideMove[speed]
      }
      if (this.gameKeyDown[this.keyLeft]) {
        side -= this.sideMove[speed]
      }
      if (this.joyXMove > 0) {
        side += this.sideMove[speed]
      }
      if (this.joyXMove < 0) {
        side -= this.sideMove[speed]
      }
    } else {
      if (this.gameKeyDown[this.keyRight]) {
        cmd.angleTurn -= this.angleTurn[tSpeed]
      }
      if (this.gameKeyDown[this.keyLeft]) {
        cmd.angleTurn += this.angleTurn[tSpeed]
      }
      if (this.joyXMove > 0) {
        cmd.angleTurn -= this.angleTurn[tSpeed]
      }
      if (this.joyXMove < 0) {
        cmd.angleTurn += this.angleTurn[tSpeed]
      }
    }

    if (this.gameKeyDown[this.keyUp]) {
      forward += this.forwardMove[speed]
    }
    if (this.gameKeyDown[this.keyDown]) {
      forward -= this.forwardMove[speed]
    }
    if (this.joyYMove < 0) {
      forward += this.forwardMove[speed]
    }
    if (this.joyYMove > 0) {
      forward -= this.forwardMove[speed]
    }
    if (this.gameKeyDown[this.keyStrafeRight]) {
      side += this.sideMove[speed]
    }
    if (this.gameKeyDown[this.keyStrafeLeft]) {
      side -= this.sideMove[speed]
    }

    // buttons
    if (this.gameKeyDown[this.keyFire] || this.mouseButtons[this.mouseBFire] || this.joyButtons[this.joyBFire]) {
      cmd.buttons |= ButtonCode.Attack
    }

    if (this.gameKeyDown[this.keyUse] || this.joyButtons[this.joyBUse]) {
      cmd.buttons |= ButtonCode.Use
      // clear double clicks if hit use button
      this.dClicks = 0
    }

    // chainsaw overrides
    for (let i = 0; i < WeaponType.NUM_WEAPONS - 1; i++) {
      if (this.gameKeyDown[ScanCode.Digit1 + i]) {
        cmd.buttons |= ButtonCode.Change
        cmd.buttons |= i << ButtonCode.WeaponShift
        break
      }
    }

    // mouse
    if (this.mouseButtons[this.mouseBForward]) {
      forward += this.forwardMove[speed]
    }

    // forward double click
    if (this.mouseButtons[this.mouseBForward] !== this.dClickState && this.dClickTime > 1) {
      this.dClickState = this.mouseButtons[this.mouseBForward]
      if (this.dClickState) {
        this.dClicks++
      }
      if (this.dClicks === 2) {
        cmd.buttons |= ButtonCode.Use
        this.dClicks = 0
      } else {
        this.dClickTime = 0
      }
    } else {
      this.dClickTime += this.net.ticDup
      if (this.dClickTime > 20) {
        this.dClicks = 0
        this.dClickState = false
      }
    }

    // Note: Original code features a "strafe double click" here.
    // https://github.com/id-Software/DOOM/blob/a77dfb96cb91780ca334d0d4cfd86957558007e0/linuxdoom-1.10/g_game.c#L378

    forward += this.mouseY
    if (strafe) {
      side += this.mouseX * 2
    } else {
      cmd.angleTurn -= this.mouseX * 0x8
    }

    this.mouseX = 0
    this.mouseY = 0

    if (forward > MAX_PL_MOVE) {
      forward = MAX_PL_MOVE
    } else if (forward < -MAX_PL_MOVE) {
      forward = -MAX_PL_MOVE
    }
    if (side > MAX_PL_MOVE) {
      side = MAX_PL_MOVE
    } else if (side < -MAX_PL_MOVE) {
      side = -MAX_PL_MOVE
    }

    cmd.forwardMove += forward
    cmd.sideMove += side

    // special buttons
    if (this.sendPause) {
      this.sendPause = false
      cmd.buttons = ButtonCode.Special |
        ButtonCode.Pause
    }
    if (this.sendSave) {
      this.sendSave = false
      cmd.buttons = ButtonCode.Special |
        ButtonCode.SaveGame |
        this.saveGameSlot << ButtonCode.SaveShift
    }
  }

  //
  // G_DoLoadLevel
  //
  private doLoadLevel(): void {
    if (this.doom.wipeGameState === GameState.Level) {
      // force a wipe
      this.doom.wipeGameState = -1
    }

    this.gameState = GameState.Level

    for (let i = 0; i < MAX_PLAYERS; ++i) {
      if (this.playerInGame[i] && this.players[i].playerState === PlayerState.Dead) {
        this.players[i].playerState = PlayerState.Reborn
        this.players[i].frags.fill(0)
      }
    }

    this.play.setupLevel(this.gameEpisode, this.gameMap)
    // view the guy you are playing
    this.displayPlayer = this.consolePlayer
    this.startTime = getTime()
    this.gameAction = GameAction.Nothing

    // clear cmd building stuff
    this.gameKeyDown.fill(false)
    this.joyXMove = this.joyYMove = 0
    this.mouseX = this.mouseY = 0
    this.sendPause = this.sendSave = this.paused = false
    this.mouseButtons.fill(false)
    this.joyButtons.fill(false)

    this.setSkyMap(this.play.level.sky)
  }

  //
  // G_Responder
  // Get info needed to make ticcmd_ts for the players.
  //
  responder(ev: DEvent): boolean {
    // allow spy mode changes even during the demo
    if (this.gameState === GameState.Level && ev.type === EvType.KeyDown &&
      ev.data1 === ScanCode.F12 && (this.singleDemo || !this.deathMatch)) {
      // spy mode
      do {
        this.displayPlayer++
        if (this.displayPlayer === MAX_PLAYERS) {
          this.displayPlayer = 0
        }
      } while (!this.playerInGame[this.displayPlayer] && this.displayPlayer !== this.consolePlayer)

      return true
    }

    // any other key pops up menu if in demos
    if (this.gameAction === GameAction.Nothing && !this.singleDemo &&
      (this.demoPlayback || this.gameState === GameState.DemoScreen)) {
      if (ev.type === EvType.KeyDown ||
        ev.type === EvType.Mouse && ev.data1 ||
        ev.type === EvType.Joystick && ev.data1) {
        this.menu.startControlPanel()
        return true
      }
      return false
    }

    if (this.gameState === GameState.Level) {
      if (this.headsUp.responder(ev)) {
        // chat ate the event
        return true
      }
      if (this.statusBar.responder(ev)) {
        // status window ate it
        return true
      }
      if (this.autoMap.responder(ev)) {
        // automap ate it
        return true
      }
    }

    if (this.gameState === GameState.Finale) {
      if (this.finale.responder(ev)) {
        // finale ate the event
        return true
      }
    }

    switch (ev.type) {
    case EvType.KeyDown:
      if (ev.data1 === ScanCode.Pause) {
        this.sendPause = true
        return true
      }
      if (ev.data1 < NUM_KEYS) {
        this.gameKeyDown[ev.data1] = true
      }
      // eat key down events
      return true
    case EvType.KeyUp:
      if (ev.data1 < NUM_KEYS) {
        this.gameKeyDown[ev.data1] = false
      }
      // always let key up events filter down
      return false
    case EvType.Mouse:
      this.mouseButtons[0] = !!(ev.data1 & 1)
      this.mouseButtons[1] = !!(ev.data1 & 2)
      this.mouseButtons[2] = !!(ev.data1 & 4)
      this.mouseX = ev.data2 * (this.mouseSensitivity + 5) / 10
      this.mouseY = ev.data3 * (this.mouseSensitivity + 5) / 10
      // eat events
      return true
    case EvType.Joystick:
      this.joyButtons[0] = !!(ev.data1 & 1)
      this.joyButtons[1] = !!(ev.data1 & 2)
      this.joyButtons[2] = !!(ev.data1 & 4)
      this.joyButtons[3] = !!(ev.data1 & 8)
      this.joyXMove = ev.data2
      this.joyYMove = ev.data3
      // eat events
      return true
    default:
      break
    }

    return false
  }

  //
  // G_Ticker
  // Make ticcmd_ts for the players.
  //
  ticker(): void {
    // do player reborns if needed
    for (let i = 0; i < MAX_PLAYERS; ++i) {
      if (this.playerInGame[i] && this.players[i].playerState === PlayerState.Reborn) {
        this.doReborn(i)
      }
    }

    while (this.gameAction !== GameAction.Nothing) {
      switch (this.gameAction) {
      case GameAction.Pending:
        return
      case GameAction.LoadLevel:
        this.doLoadLevel()
        break
      case GameAction.NewGame:
        this.doNewGame()
        break
      case GameAction.LoadGame:
        this.doLoadGame()
        break
      case GameAction.SaveGame:
        this.doSaveGame()
        break
      case GameAction.PlayDemo:
        this.doPlayDemo()
        break
      case GameAction.Completed:
        this.doCompleted()
        break
      case GameAction.Victory:
        this.finale.start()
        break
      case GameAction.WorldDone:
        this.doWorldDone()
        break
      }
    }

    // get commands, check consistancy,
    // and build new consistancy check
    const buf = this.gameTic / this.net.ticDup % BACKUP_TICS

    let cmd: TickCmd
    for (let i = 0; i < MAX_PLAYERS; ++i) {
      if (this.playerInGame[i]) {
        cmd = this.players[i].cmd
        cmd.copyFrom(this.net.netCmds[i][buf])

        if (this.demoPlayback) {
          this.readDemoTicCmd(cmd)
        }
        if (this.demoRecording) {
          this.writeDemoTicCmd(cmd)
        }
      }
    }

    // check for special buttons
    for (let i = 0; i < MAX_PLAYERS; i++) {
      if (this.playerInGame[i]) {
        if (this.players[i].cmd.buttons & ButtonCode.Special) {
          switch (this.players[i].cmd.buttons & ButtonCode.SpecialMask) {
          case ButtonCode.Pause:
            this.paused = !this.paused
            if (this.paused) {
              this.dSound.pauseSound()
            } else {
              this.dSound.resumeSound()
            }
            break

          case ButtonCode.SaveGame:
            if (!this.saveDescription) {
              this.saveDescription = 'NET GAME'
            }
            this.saveGameSlot = (this.players[i].cmd.buttons & ButtonCode.SaveMask) >> ButtonCode.SaveShift

            this.gameAction = GameAction.SaveGame
            break
          }
        }
      }
    }

    // do main actions
    switch (this.gameState) {
    case GameState.Level:
      this.tick.ticker()
      this.statusBar.ticker()
      this.autoMap.ticker()
      this.headsUp.ticker()
      break
    case GameState.Intermission:
      this.win.ticker()
      break
    case GameState.Finale:
      this.finale.ticker()
      break
    case GameState.DemoScreen:
      this.doom.pageTicker()
      break
    }

    this.updateDebugFromGame()
  }

  //
  // PLAYER STRUCTURE FUNCTIONS
  // also see P_SpawnPlayer in P_Things
  //

  //
  // G_InitPlayer
  // Called at the start.
  // Called by the game initialization functions.
  //
  initPlayer(player: number): void {
    // clear everthing else to default
    this.playerReborn(player)
  }

  //
  // G_PlayerFinishLevel
  // Can when a player completes a level.
  //
  private playerFinishLevel(player: number): void {
    const p = this.players[player]

    p.powers.fill(0)
    p.cards.fill(false)

    if (p.mo === null) {
      throw 'p.mo = null'
    }

    // cancel invisibility
    p.mo.flags &= ~MObjFlag.Shadow
    // cancel gun flashes
    p.extraLight = 0
    // cancel ir gogles
    p.fixedColorMap = 0
    // no palette changes
    p.damageCount = 0
    p.bonusCount = 0
  }

  //
  // G_PlayerReborn
  // Called after a player dies
  // almost everything is cleared and initialized
  //
  playerReborn(player: number): void {
    const frags = [ ...this.players[player].frags ]
    const killCount = this.players[player].killCount
    const itemCount = this.players[player].itemCount
    const secretCount = this.players[player].secretCount

    const p = this.players[player]
    p.reset()

    p.frags.splice(0, p.frags.length, ...frags)
    p.killCount = killCount
    p.itemCount = itemCount
    p.secretCount = secretCount

    // don't do anything immediately
    p.useDown = p.attackDown = true
    p.playerState = PlayerState.Live
    p.health = MAX_HEALTH
    p.readyWeapon = p.pendingWeapon = WeaponType.Pistol
    p.weaponOwned[WeaponType.Fist] = true
    p.weaponOwned[WeaponType.Pistol] = true
    p.ammo[AmmoType.Clip] = 50

    for (let i = 0; i < AmmoType.NUM_AMMO; ++i) {
      p.maxAmmo[i] = maxAmmo[i]
    }
  }

  //
  // G_DoReborn
  //
  doReborn(_playerNum: number): void {
    if (!this.netGame) {
      // reload the level from scratch
      this.gameAction = GameAction.LoadLevel
    } else {
      // respawn at the start
      // TODO
    }
  }

  //
  // G_DoCompleted
  //

  private secretExit = false

  exitLevel(): void {
    this.secretExit = false
    this.gameAction = GameAction.Completed
  }

  // Here's for the german edition.
  secretExitLevel(): void {
    // IF NO WOLF3D LEVELS, NO SECRET EXIT!
    if (this.doom.instance.mode === GameMode.Commercial &&
      this.wad.checkNumForName('map31') < 0) {
      this.secretExit = false
    } else {
      this.secretExit = true
      this.gameAction = GameAction.Completed
    }
  }

  private doCompleted(): void {
    this.gameAction = GameAction.Nothing

    for (let i = 0; i < MAX_PLAYERS; ++i) {
      if (this.playerInGame[i]) {
        // take away cards and stuff
        this.playerFinishLevel(i)
      }
    }

    if (this.autoMap.active) {
      this.autoMap.stop()
    }

    if (this.doom.instance.mode !== GameMode.Commercial) {
      if (this.doom.instance.version === GameVersion.Chex) {
        if (this.gameMap === 5) {
          this.gameAction = GameAction.Victory
          return
        }
      } else {
        switch (this.gameMap) {
        case 8:
          this.gameAction = GameAction.Victory
          return
        case 9:
          for (let i = 0; i < MAX_PLAYERS; ++i) {
            this.players[i].didSecret = true
          }
          break
        }
      }
    }

    this.wmInfo.didSecret = this.player.didSecret
    this.wmInfo.episode = this.gameEpisode - 1
    this.wmInfo.last = this.gameMap - 1

    // wminfo.next is 0 biased, unlike gamemap
    if (this.doom.instance.mode === GameMode.Commercial) {
      if (this.secretExit) {
        switch (this.gameMap) {
        case 15:
          this.wmInfo.next = 30
          break
        case 31:
          this.wmInfo.next = 31
          break
        }
      } else {
        switch (this.gameMap) {
        case 31:
        case 32:
          this.wmInfo.next = 15
          break
        default:
          this.wmInfo.next = this.gameMap
          break
        }
      }
    } else {
      if (this.secretExit) {
        // go to secret level
        this.wmInfo.next = 8
      } else if (this.gameMap === 9) {
        // returning from secret level
        switch (this.gameEpisode) {
        case 1:
          this.wmInfo.next = 3
          break
        case 2:
          this.wmInfo.next = 5
          break
        case 3:
          this.wmInfo.next = 6
          break
        case 4:
          this.wmInfo.next = 2
          break
        }
      } else {
        // go to next level
        this.wmInfo.next = this.gameMap
      }
    }

    this.wmInfo.maxKills = this.totalKills
    this.wmInfo.maxItems = this.totalItems
    this.wmInfo.maxSecret = this.totalSecret
    this.wmInfo.maxFrags = 0
    if (this.doom.instance.mode === GameMode.Commercial) {
      if (this.gameMap === 33) {
        // wtf ?
        this.wmInfo.parTime = 1835884871
      } else {
        this.wmInfo.parTime = TICRATE * cPars[this.gameMap - 1]
      }
    } else if (this.gameEpisode < 4) {
      this.wmInfo.parTime = TICRATE * pars[this.gameEpisode][this.gameMap]
    } else {
      this.wmInfo.parTime = TICRATE * cPars[this.gameMap]
    }
    this.wmInfo.pNum = this.consolePlayer

    for (let i = 0; i < MAX_PLAYERS; ++i) {
      this.wmInfo.players[i].in = this.playerInGame[i]
      this.wmInfo.players[i].sKills = this.players[i].killCount
      this.wmInfo.players[i].sItems = this.players[i].itemCount
      this.wmInfo.players[i].sSecret = this.players[i].secretCount
      this.wmInfo.players[i].sTime = this.tick.levelTime
      this.wmInfo.players[i].frags = [ ...this.players[i].frags ]
    }

    this.gameState = GameState.Intermission
    this.viewActive = false
    this.autoMap.active = false

    this.win.start(this.wmInfo)
  }

  //
  // G_WorldDone
  //
  worldDone(): void {
    this.gameAction = GameAction.WorldDone

    if (this.secretExit) {
      this.player.didSecret = true
    }

    if (this.doom.instance.mode === GameMode.Commercial) {
      switch (this.gameMap) {
      case 15:
      case 31:
        if (!this.secretExit) {
          break
        }
        // fallthrough
      case 6:
      case 11:
      case 20:
      case 30:
        this.finale.start()
        break
      }
    }
  }

  private doWorldDone(): void {
    this.gameState = GameState.Level
    this.gameMap = this.wmInfo.next + 1
    this.doLoadLevel()
    this.gameAction = GameAction.Nothing
    this.viewActive = true
  }

  private saveName = ''

  loadGame(name: string): void {
    this.saveName = name
    this.gameAction = GameAction.LoadGame
  }

  private async doLoadGame(): Promise<void> {
    this.gameAction = GameAction.Pending

    const saveBuffer = await fs.open(this.saveName)
    if (saveBuffer === undefined) {
      throw 'saveBuffer = undefined'
    }

    const int8 = new Uint8Array(saveBuffer)
    let saveP = SAVE_STRING_SIZE

    const vCheck1 = `version ${this.vanillaVersionCode()}`
    const vCheck2 = tostring(saveBuffer, saveP, VERSION_SIZE)
    if (vCheck1 !== vCheck2) {
      // bad version
      return
    }

    saveP += VERSION_SIZE

    this.gameSkill = int8[saveP++]
    this.gameEpisode = int8[saveP++]
    this.gameMap = int8[saveP++]

    for (let i = 0; i < MAX_PLAYERS; ++i) {
      this.playerInGame[i] = !!int8[saveP++]
    }

    // load a base level
    this.initNew(this.gameSkill, this.gameEpisode, this.gameMap)

    const a = int8[saveP++]
    const b = int8[saveP++]
    const c = int8[saveP++]
    this.tick.levelTime = (a << 16) + (b << 8) + c

    // dearchive all the modifications
    saveP = this.saveGame.unArchivePlayers(saveBuffer, saveP)
    saveP = this.saveGame.unArchiveWorld(saveBuffer, saveP)
    saveP = this.saveGame.unArchiveThinkers(saveBuffer, saveP)
    saveP = this.saveGame.unArchiveSpecials(saveBuffer, saveP)

    if (int8[saveP++] !== 0x1d) {
      throw 'Bad savegame'
    }

    if (this.rendering.setSizeNeeded) {
      this.rendering.executeSetViewSize()
    }
  }

  //
  // G_SaveGame
  // Called by the menu task.
  // Description is a 24 byte text string
  //
  setSaveGame(slot: number, description: string): void {
    this.saveGameSlot = slot
    this.saveDescription = description
    this.sendSave = true
  }

  private async doSaveGame(): Promise<void> {
    const name = `${SAVE_GAME_NAME}${this.saveGameSlot}.dsg`

    const saveBuffer = new ArrayBuffer(SAVE_GAME_SIZE)
    const int8 = new Uint8Array(saveBuffer)
    let saveP = 0

    const description = this.saveDescription

    for (let i = 0; i < SAVE_STRING_SIZE; ++i) {
      int8[saveP++] = description.charCodeAt(i)
    }

    const name2 = `version ${this.vanillaVersionCode()}`

    for (let i = 0; i < VERSION_SIZE; ++i) {
      int8[saveP++] = name2.charCodeAt(i)
    }

    int8[saveP++] = this.gameSkill
    int8[saveP++] = this.gameEpisode
    int8[saveP++] = this.gameMap
    for (let i = 0; i < MAX_PLAYERS; ++i) {
      int8[saveP++] = this.playerInGame[i] ? 1 : 0
    }
    int8[saveP++] = this.tick.levelTime >> 16
    int8[saveP++] = this.tick.levelTime >> 8
    int8[saveP++] = this.tick.levelTime

    saveP = this.saveGame.archivePlayers(saveBuffer, saveP)
    saveP = this.saveGame.archiveWorld(saveBuffer, saveP)
    saveP = this.saveGame.archiveThinkers(saveBuffer, saveP)
    saveP = this.saveGame.archiveSpecials(saveBuffer, saveP)

    // consistancy marker
    int8[saveP++] = 0x1d

    if (saveP > SAVE_GAME_SIZE) {
      throw 'Savegame buffer overrun'
    }

    this.gameAction = GameAction.Pending

    await fs.write(name, saveBuffer.slice(0, saveP))

    this.gameAction = GameAction.Nothing
    this.saveDescription = ''

    this.player.message = this.doom.strings.ggsaved
  }

  //
  // G_InitNew
  // Can be called by the startup code or the menu task,
  // consoleplayer, displayplayer, playeringame[] should be set.
  //
  private skill: Skill = -1
  private episode = -1
  private map = -1

  deferedInitNew(skill: Skill, episode: number, map: number): void {
    this.skill = skill
    this.episode = episode
    this.map = map
    this.gameAction = GameAction.NewGame
  }

  private doNewGame(): void {
    this.demoPlayback = false
    this.netGame = false
    this.deathMatch = 0
    this.playerInGame[1] = this.playerInGame[2] = this.playerInGame[3] = false
    this.doom.respawnParam = false
    this.doom.fastParam = false
    this.doom.noMonsters = false
    this.consolePlayer = 0
    this.initNew(this.skill, this.episode, this.map)
    this.gameAction = GameAction.Nothing
  }

  initNew(skill: Skill, episode: number, map: number): void {
    if (this.paused) {
      this.paused = false
      this.dSound.resumeSound()
    }

    if (skill > Skill.Nightmare) {
      skill = Skill.Nightmare
    }

    if (this.doom.instance.version >= GameVersion.Ultimate) {
      if (episode === 0) {
        episode = 4
      }
    } else {
      if (episode < 1) {
        episode = 1
      }
      if (episode > 3) {
        episode = 3
      }
    }

    if (episode > 1 && this.doom.instance.mode === GameMode.Shareware) {
      episode = 1
    }

    if (map < 1) {
      map = 1
    }

    if (map > 9 && this.doom.instance.mode !== GameMode.Commercial) {
      map = 9
    }

    random.clearRandom()

    if (skill === Skill.Nightmare || this.doom.respawnParam) {
      this.respawnMonsters = true
    } else {
      this.respawnMonsters = false
    }

    if (this.doom.fastParam || skill === Skill.Nightmare && this.gameSkill !== Skill.Nightmare) {
      for (let i = StateNum.SargRun1; i <= StateNum.SargPain2; ++i) {
        states[i].tics >>= 1
        mObjInfos[MObjType.Bruisershot].speed = 20 * FRACUNIT
        mObjInfos[MObjType.Headshot].speed = 20 * FRACUNIT
        mObjInfos[MObjType.Troopshot].speed = 20 * FRACUNIT
      }
    } else if (skill !== Skill.Nightmare && this.gameSkill === Skill.Nightmare) {
      for (let i = StateNum.SargRun1; i <= StateNum.SargPain2; ++i) {
        states[i].tics <<= 1
        mObjInfos[MObjType.Bruisershot].speed = 15 * FRACUNIT
        mObjInfos[MObjType.Headshot].speed = 10 * FRACUNIT
        mObjInfos[MObjType.Troopshot].speed = 10 * FRACUNIT
      }
    }

    // force players to be initialized upon first level load
    for (let i = 0; i < MAX_PLAYERS; ++i) {
      this.players[i].playerState = PlayerState.Reborn
    }

    // will be set false if a demo
    this.userGame = true
    this.paused = false
    this.demoPlayback = false
    this.autoMap.active = false
    this.viewActive = true
    this.gameEpisode = episode
    this.gameMap = map
    this.gameSkill = skill

    this.viewActive = true

    this.doLoadLevel()
  }

  private setSkyMap(sky: Sky): void {
    const rData = this.rData

    const skyPatch = this.doom.instance.getSkyPatch(this.gameEpisode, this.gameMap)
    sky.texture = rData.textures.numForName(skyPatch)

    // Set the sky map.
    // First thing, we have a dummy sky texture name,
    //  a flat. The data is in the WAD only because
    //  we look for an actual index, instead of simply
    //  setting one.

    sky.flatNum = rData.flats.numForName(SKY_FLAT_NAME)
  }

  //
  // DEMO RECORDING
  //
  private readDemoTicCmd(cmd: TickCmd): void {
    if (!this.demo.readDemoTicCmd(cmd)) {
      this.checkDemoStatus()
    }
  }

  private writeDemoTicCmd(cmd: TickCmd): void {
    // press q to end demo recording
    if (this.gameKeyDown[ScanCode.KeyQ]) {
      this.checkDemoStatus()
    }

    this.demo.writeDemoTicCmd(cmd)
  }

  //
  // G_RecordDemo
  //
  recordDemo(name: string): void {
    this.userGame = false
    this.demoName = `${name}.lmp`
    this.demo = new Demo()

    this.demoRecording = true
  }

  beginRecording(): void {
    this.demo.version = this.vanillaVersionCode()
    this.demo.skill = this.gameSkill
    this.demo.episode = this.gameEpisode
    this.demo.map = this.gameMap
    this.demo.deathMatch = this.deathMatch
    this.demo.respawnParam = this.doom.respawnParam
    this.demo.fastParam = this.doom.fastParam
    this.demo.noMonsters = this.doom.noMonsters
    this.demo.consolePlayer = this.consolePlayer

    this.demo.playerInGame = [ ...this.playerInGame ]

    this.demo.beginRecording()
  }

  private vanillaVersionCode(): number {
    // Get the demo version code appropriate for the version set in gameversion.
    switch (this.doom.instance.version) {
    case GameVersion.Doom1666:
      return 106
    case GameVersion.Doom17:
      return 107
    case GameVersion.Doom18:
      return 108
    case GameVersion.Doom19:
    default:
      // All other versions are variants on v1.9:
      return 109
    }
  }

  //
  // G_PlayDemo
  //
  private defDemoName = ''

  deferedPlayDemo(name: string): void {
    this.defDemoName = name
    this.gameAction = GameAction.PlayDemo
  }

  private doPlayDemo(): void {
    this.gameAction = GameAction.Nothing

    this.demo = this.wad.cacheLumpName(this.defDemoName, Demo)

    this.demo.beginPlaying()

    if (this.demo.version !== this.vanillaVersionCode() &&
      !(this.doom.instance.version <= GameVersion.Doom12 && this.demo.old)) {
      throw `Demo is from a different game version (read ${this.demo.version}, should be ${this.vanillaVersionCode()})`
    }

    this.skill = this.demo.skill
    this.episode = this.demo.episode
    this.map = this.demo.map

    this.deathMatch = this.demo.deathMatch
    this.doom.respawnParam = this.demo.respawnParam
    this.doom.fastParam = this.demo.fastParam
    this.doom.noMonsters = this.demo.noMonsters
    this.consolePlayer = this.demo.consolePlayer

    for (let i = 0; i < MAX_PLAYERS; ++i) {
      this.playerInGame[i] = this.demo.playerInGame[i]
    }

    this.netGame = this.demo.netGame

    this.initNew(this.skill, this.episode, this.map)

    this.userGame = false
    this.demoPlayback = true
  }

  /*
  ===================
  =
  = G_CheckDemoStatus
  =
  = Called after a death or level completion to allow demos to be cleaned up
  = Returns true if a new demo loop action will take place
  ===================
  */
  private checkDemoStatus(): boolean {
    if (this.timingDemo) {
      const endTime = getTime()

      throw `timed ${this.gameTic} gametics in ${endTime - this.startTime} realtics`
    }

    if (this.demoPlayback) {
      if (this.singleDemo) {
        this.doom.quit()
        return false
      }

      this.demoPlayback = false
      this.netGame = false
      this.deathMatch = 0
      this.playerInGame[1] = this.playerInGame[2] = this.playerInGame[3] = false
      this.doom.respawnParam = false
      this.doom.fastParam = false
      this.doom.noMonsters = false
      this.consolePlayer = 0
      this.doom.advanceDemo()
      return true
    }

    if (this.demoRecording) {
      fs.write(this.demoName, this.demo.archive())

      this.demoRecording = false

      this.doom.quit()
      throw `Demo ${this.demoName} recorded`
    }

    return false
  }

  private debug = {
    position: { x: 0, y: 0, z: 0, angle: 0 },
    health: { health: 0, armor: false, megaArmor: false, armorPoints: 0 },
    cards: {
      blueCard: false, yellowCard: false, redCard: false,
      blueSkull: false, yellowSkull: false, redSkull: false,
    },
    weapons: {
      fist: false, pistol: false, shotgun: false,
      chaingun: false, missile: false, plasma: false,
      bfg: false, chainsaw: false, supershotgun: false,
      clips: 0, shells: 0, cells: 0, missiles: 0,
    },
    cheats: { noClip: false, godMode: false, noMomentum: false },
    powers: {
      invulnerability: () => {
      },
      strength: () => {
      },
      invisibility: () => {
      },
      ironfeet: () => {
      },
      allMap: () => {
      },
      infrared: () => {
      },
    },
  }

  private updateDebugFromGame() {
    const {
      debug: { position, health, cards, weapons, cheats },
      player,
    } = this

    if (!player.mo) {
      return
    }
    position.x = player.mo.x >> FRACBITS
    position.y = player.mo.y >> FRACBITS
    position.z = player.mo.z >> FRACBITS
    position.angle = toDeg(player.mo.angle)

    health.health = player.health
    health.armor = player.armorType === ArmorType.Armor
    health.megaArmor = player.armorType === ArmorType.MegaArmor
    health.armorPoints = player.armorPoints

    cards.blueCard = player.cards[Card.BlueCard]
    cards.yellowCard = player.cards[Card.YellowCard]
    cards.redCard = player.cards[Card.RedCard]
    cards.blueSkull = player.cards[Card.BlueSkull]
    cards.yellowSkull = player.cards[Card.YellowSkull]
    cards.redSkull = player.cards[Card.RedSkull]

    weapons.fist = player.weaponOwned[WeaponType.Fist]
    weapons.pistol = player.weaponOwned[WeaponType.Pistol]
    weapons.shotgun = player.weaponOwned[WeaponType.Shotgun]
    weapons.chaingun = player.weaponOwned[WeaponType.Chaingun]
    weapons.missile = player.weaponOwned[WeaponType.Missile]
    weapons.plasma = player.weaponOwned[WeaponType.Plasma]
    weapons.bfg = player.weaponOwned[WeaponType.BFG]
    weapons.chainsaw = player.weaponOwned[WeaponType.Chainsaw]
    weapons.supershotgun = player.weaponOwned[WeaponType.Supershotgun]

    weapons.clips = player.ammo[AmmoType.Clip]
    weapons.shells = player.ammo[AmmoType.Shell]
    weapons.cells = player.ammo[AmmoType.Cell]
    weapons.missiles = player.ammo[AmmoType.Misl]

    cheats.noClip = !!(player.cheats & Cheat.NoClip)
    cheats.godMode = !!(player.cheats & Cheat.GodMode)
    cheats.noMomentum = !!(player.cheats & Cheat.NoMomentum)
  }

  private updateGameFromDebug() {
    const {
      debug: { position, health, cards, weapons, cheats },
      player,
    } = this

    if (!player.mo) {
      return
    }

    player.mo.x = position.x << FRACBITS
    player.mo.y = position.y << FRACBITS
    player.mo.z = position.z << FRACBITS
    player.mo.angle = fromDeg(position.angle)

    player.health = player.mo.health = health.health
    player.armorType = health.megaArmor ? ArmorType.MegaArmor : health.armor ? ArmorType.Armor : ArmorType.None
    player.armorPoints = health.armorPoints

    player.cards[Card.BlueCard] = cards.blueCard
    player.cards[Card.YellowCard] = cards.yellowCard
    player.cards[Card.RedCard] = cards.redCard
    player.cards[Card.BlueSkull] = cards.blueSkull
    player.cards[Card.YellowSkull] = cards.yellowSkull
    player.cards[Card.RedSkull] = cards.redSkull

    player.weaponOwned[WeaponType.Fist] = weapons.fist
    player.weaponOwned[WeaponType.Pistol] = weapons.pistol
    player.weaponOwned[WeaponType.Shotgun] = weapons.shotgun
    player.weaponOwned[WeaponType.Chaingun] = weapons.chaingun
    player.weaponOwned[WeaponType.Missile] = weapons.missile
    player.weaponOwned[WeaponType.Plasma] = weapons.plasma
    player.weaponOwned[WeaponType.BFG] = weapons.bfg
    player.weaponOwned[WeaponType.Chainsaw] = weapons.chainsaw
    player.weaponOwned[WeaponType.Supershotgun] = weapons.supershotgun

    player.ammo[AmmoType.Clip] = weapons.clips
    player.ammo[AmmoType.Shell] = weapons.shells
    player.ammo[AmmoType.Cell] = weapons.cells
    player.ammo[AmmoType.Misl] = weapons.missiles

    player.cheats = (cheats.noClip ? Cheat.NoClip : 0) |
      (cheats.godMode ? Cheat.GodMode : 0) |
      (cheats.noMomentum ? Cheat.NoMomentum : 0)
  }

  setupDebugGui(gui: GUI) {
    const {
      debug: { position, health, cards, weapons, cheats, powers },
    } = this

    const playerFolder = gui.addFolder('Player')

    const positionFolder = playerFolder.addFolder('Position').open(false)
    positionFolder.add(position, 'x')
    positionFolder.add(position, 'y')
    positionFolder.add(position, 'z')
    positionFolder.add(position, 'angle').min(0).max(360)

    const healthFolder = playerFolder.addFolder('Health').open(false)
    healthFolder.add(health, 'health').min(0).max(100).step(1)
    healthFolder.add(health, 'armor')
    healthFolder.add(health, 'megaArmor')
    healthFolder.add(health, 'armorPoints').min(0).max(200).step(1)

    const cardsFolder = playerFolder.addFolder('Cards').open(false)
    cardsFolder.add(cards, 'blueCard')
    cardsFolder.add(cards, 'yellowCard')
    cardsFolder.add(cards, 'redCard')
    cardsFolder.add(cards, 'blueSkull')
    cardsFolder.add(cards, 'yellowSkull')
    cardsFolder.add(cards, 'redSkull')

    const weaponsFolder = playerFolder.addFolder('Weapons').open(false)
    weaponsFolder.add(weapons, 'fist')
    weaponsFolder.add(weapons, 'pistol')
    weaponsFolder.add(weapons, 'shotgun')
    weaponsFolder.add(weapons, 'chaingun')
    weaponsFolder.add(weapons, 'missile')
    weaponsFolder.add(weapons, 'plasma')
    weaponsFolder.add(weapons, 'bfg')
    weaponsFolder.add(weapons, 'chainsaw')
    weaponsFolder.add(weapons, 'supershotgun')

    weaponsFolder.add(weapons, 'clips').min(0).max(999).step(1)
    weaponsFolder.add(weapons, 'shells').min(0).max(999).step(1)
    weaponsFolder.add(weapons, 'cells').min(0).max(999).step(1)
    weaponsFolder.add(weapons, 'missiles').min(0).max(999).step(1)

    const cheatsFolder = playerFolder.addFolder('Cheats').open(false)
    cheatsFolder.add(cheats, 'noClip')
    cheatsFolder.add(cheats, 'godMode')
    cheatsFolder.add(cheats, 'noMomentum')

    const powersFolder = playerFolder.addFolder('Powers').open(false)
    powers.invulnerability = () => this.inter.givePower(this.player, PowerType.Invulnerability)
    powersFolder.add(powers, 'invulnerability')
    powers.strength = () => this.inter.givePower(this.player, PowerType.Strength)
    powersFolder.add(powers, 'strength')
    powers.invisibility = () => this.inter.givePower(this.player, PowerType.Invisibility)
    powersFolder.add(powers, 'invisibility')
    powers.ironfeet = () => this.inter.givePower(this.player, PowerType.Ironfeet)
    powersFolder.add(powers, 'ironfeet')
    powers.allMap = () => this.inter.givePower(this.player, PowerType.AllMap)
    powersFolder.add(powers, 'allMap')
    powers.infrared = () => this.inter.givePower(this.player, PowerType.Infrared)
    powersFolder.add(powers, 'infrared')

    playerFolder.controllersRecursive().forEach(c => {
      c.onChange(() => this.updateGameFromDebug())
      c.listen()
    })
  }
}
