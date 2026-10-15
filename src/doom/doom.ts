import { BlankRenderer, RenderingInterface, RenderingMode } from './rendering/rendering-interface'
import { BlankVideo, VideoInterface } from './interfaces/video-interface'
import { DEvent, GameAction, MAX_EVENTS } from './doom/event'
import { GameMode, Language, Skill } from './doom/mode'
import { GameState, SCREENHEIGHT, SCREENWIDTH } from './global/doomdef'
import { AutoMap } from './auto-map/auto-map'
import { Sound as DSound } from './doom/sound'
import { Defaults } from './misc/defaults'
import { EnglishStrings } from './translation/english'
import { Finale } from './finale/finale'
import GUI from 'lil-gui'
import { Game } from './game/game'
import { GameInstance } from './doom/instance'
import { HeadsUp } from './heads-up/stuff'
import { Net as INet } from './interfaces/net'
import { Sound as ISound } from './interfaces/sound'
import { Input } from './interfaces/input'
import { LumpReader } from './wad/lump-reader'
import { Menu } from './menu/menu'
import { MusicName } from './doom/sounds/music-name'
import { Net } from './doom/net'
import { Palettes } from './interfaces/palette'
import { Params } from './doom/params'
import { Patch } from './rendering/defs/patch'
import { Play } from './play/setup'
import { PlayerState } from './doom/player'
import { Data as RData } from './rendering/data'
import { Video as RVIdeo } from './rendering/video'
import Stats from 'stats.js'
import { StatusBar } from './status/stuff'
import { Strings } from './translation/strings'
import { Win } from './win/win'
import { Wipe } from './wipe'
import { displayEndoom } from './misc/endoom'
import { getTime } from './system/system'
import { validCounter } from './play/valid-counter'

export class Doom {
  onError: (e: unknown) => void = () => ({})

  instance = new GameInstance({})

  // Language
  language: Language = Language.English
  strings: Strings = new EnglishStrings()

  // Set if homebrew PWAD stuff has been added.
  modifiedGame = false

  startSkill: Skill = -1
  startEpisode = -1
  startMap = -1
  private autoStart = false

  advancedemo = false

  private wadfiles: string[] = []

  // started game with -devparm
  private devParam = false
  // checkparm of -nomonsters
  noMonsters = false
  // checkparm of -respawn
  respawnParam = false
  // checkparm of -fast
  fastParam = false

  // debug flag to cancel adaptiveness
  singleTics = false

  private stats: Stats | null = null
  public gui: GUI | null = null

  public wad = new LumpReader()
  public defaults = new Defaults(this)
  public net = new Net(this)
  public iNet = new INet(this)
  public dSound = new DSound(this)
  public iSound = new ISound(this)
  public headsUp = new HeadsUp(this)
  public statusBar = new StatusBar(this)
  public play = new Play(this)
  public rVideo = new RVIdeo({ logical: [ SCREENWIDTH, SCREENHEIGHT ] })
  public rData = new RData(this.wad)
  public rendering: RenderingInterface = new BlankRenderer()
  public game = new Game(this)
  public menu = new Menu(this)
  private wipe = new Wipe(this)
  public autoMap = new AutoMap(this)
  public win = new Win(this)
  public finale = new Finale(this)

  public iVideo: VideoInterface = new BlankVideo()
  public input = new Input()

  constructor(public params: Params) {
    this.input.postEvent = ev => this.postEvent(ev)
  }

  renderingMode: RenderingMode = RenderingMode.Legacy

  async setLegacyRenderer(): Promise<void> {
    if (this.params.screen2d === undefined) {
      throw 'no 2d screen defined'
    }
    const { Rendering } = await import('./rendering/rendering')
    const { Video } = await import('./interfaces/video')
    if (this.quitted) {
      return
    }

    const palette = this.iVideo.palette
    const gamma = this.iVideo.gamma

    this.iVideo.quit()

    const { width, height } = this.iVideo
    this.iVideo = new Video(this.rVideo)
    this.iVideo.screen = this.params.screen2d
    this.iVideo.palette = palette
    this.iVideo.gamma = gamma
    this.iVideo.setSize(width, height)

    const highDetails = this.rendering.highDetails
    const screenSize = this.rendering.screenSize

    this.rendering = new Rendering(this)
    this.rendering.highDetails = highDetails
    this.rendering.screenSize = screenSize

    this.rendering.init()
    this.iVideo.init()

    this.rVideo.screens[0].alpha.fill(255)

    this.renderingMode = RenderingMode.Legacy
  }

  async setWebGLRenderer(): Promise<void> {
    if (this.params.screen3d === undefined) {
      throw 'no 3d screen defined'
    }
    const { Rendering } = await import('./webgl/rendering')
    const { Video } = await import('./webgl/video')
    if (this.quitted) {
      return
    }

    const palette = this.iVideo.palette
    const gamma = this.iVideo.gamma

    this.iVideo.quit()

    const screen2d = this.params.screen2d
    if (screen2d !== undefined) {
      const ctx = screen2d.getContext('2d')
      if (ctx !== null) {
        ctx.clearRect(0, 0, screen2d.width, screen2d.height)
      }
    }

    const { width, height } = this.iVideo
    const iVideo = new Video(this.rVideo)
    this.iVideo = iVideo
    this.iVideo.screen = this.params.screen3d
    this.iVideo.palette = palette
    this.iVideo.gamma = gamma
    iVideo.setSize(width, height)

    const highDetails = this.rendering.highDetails
    const screenSize = this.rendering.screenSize

    this.rendering = new Rendering(this, iVideo)
    this.rendering.highDetails = highDetails
    this.rendering.screenSize = screenSize

    this.rendering.init()
    this.iVideo.init()

    this.renderingMode = RenderingMode.WebGL
  }

  //
  // EVENT HANDLING
  //
  // Events are asynchronous inputs generally generated by the game user.
  // Events can be discarded if no responder claims them
  //
  private events = new Array<DEvent>(MAX_EVENTS)
  private eventHead = 0
  private eventTail = 0

  //
  // D_PostEvent
  // Called by the I/O functions when input is detected
  //
  postEvent(ev: DEvent): void {
    this.events[this.eventHead] = ev
    this.eventHead = ++this.eventHead & MAX_EVENTS - 1
  }

  //
  // D_ProcessEvents
  // Send all the events of the given timestamp down the responder chain
  //
  processEvents(): void {
    // IF STORE DEMO, DO NOT ACCEPT INPUT
    if (this.instance.mode === GameMode.Commercial &&
        this.wad.checkNumForName('map01') < 0) {
      return
    }

    let ev: DEvent
    for (; this.eventTail !== this.eventHead;
      this.eventTail = ++this.eventTail & MAX_EVENTS - 1
    ) {
      ev = this.events[this.eventTail]
      if (this.menu.responder(ev)) {
        // menu ate the event
        continue
      }
      this.game.responder(ev)
    }
  }

  // wipegamestate can be set to -1 to force a wipe on the next draw
  wipeGameState = GameState.DemoScreen
  private viewActiveState = false
  private menuActiveState = false
  private inHelpScreenState = false
  private fullScreen = false
  private oldGameState: GameState = -1
  private borderDrawCount = 0
  //
  // D_Display
  //  draw current display, possibly wiping it from the previous
  //
  private display(): void {
    // for comparative timing / profiling
    if (this.game.noDrawers) {
      return
    }

    let wipe: boolean
    let redrawsBar = false

    // change the view size if needed
    if (this.rendering.setSizeNeeded) {
      this.rendering.executeSetViewSize()
      // force background redraw
      this.oldGameState = -1
      this.borderDrawCount = 3
    }

    // save the current screen if about to wipe
    if (this.game.gameState !== this.wipeGameState) {
      wipe = true
      this.wipe.startScreen()
    } else {
      wipe = false
    }

    if (this.game.gameState === GameState.Level && this.game.gameTic) {
      this.headsUp.erase()
    }

    // do buffered drawing
    switch (this.game.gameState) {
    case GameState.Level:
      if (!this.game.gameTic) {
        break
      }
      if (this.autoMap.active) {
        this.autoMap.drawer()
      }
      if (wipe ||
        !this.rendering.fullScreen && this.fullScreen
      ) {
        redrawsBar = true
      }
      // just put away the help screen
      if (this.inHelpScreenState && !this.menu.inHelpScreens) {
        redrawsBar = true
      }
      this.statusBar.drawer(this.rendering.fullScreen, redrawsBar)
      this.fullScreen = this.rendering.fullScreen
      break
    case GameState.Intermission:
      this.win.drawer()
      break
    case GameState.Finale:
      this.finale.drawer()
      break
    case GameState.DemoScreen:
      this.pageDrawer()
      break
    }

    // draw the view directly
    if (this.game.gameState === GameState.Level &&
      !this.autoMap.active && this.game.gameTic
    ) {
      this.rendering.renderPlayerView(
        this.game.players[this.game.displayPlayer],
      )
      validCounter.inc()
    }

    if (this.game.gameState === GameState.Level && this.game.gameTic) {
      this.headsUp.drawer()
    }

    // clean up border stuff
    if (this.game.gameState !== this.oldGameState &&
      this.game.gameState !== GameState.Level
    ) {
      this.iVideo.palette = this.wad.cacheLumpName(Palettes.DEFAULT_LUMP, Palettes).p[0]
    }

    // see if the border needs to be initially drawn
    if (this.game.gameState === GameState.Level &&
      this.oldGameState !== GameState.Level
    ) {
      // view was not active
      this.viewActiveState = false
      // draw the pattern into the back screen
      this.rendering.fillBackScreen()
    }

    // see if the border needs to be updated to the screen
    if (this.game.gameState === GameState.Level &&
      !this.autoMap.active &&
      !this.rendering.fullScreen
    ) {
      if (this.menu.menuActive || this.menuActiveState || !this.viewActiveState) {
        this.borderDrawCount = 3
      }
      if (this.borderDrawCount) {
        // erase old menu stuff
        this.rendering.drawViewBorder()
        this.borderDrawCount--
        this.statusBar.drawer(this.rendering.fullScreen, true)
      }
    }

    this.menuActiveState = this.menu.menuActive
    this.viewActiveState = this.game.viewActive
    this.inHelpScreenState = this.menu.inHelpScreens
    this.oldGameState = this.wipeGameState = this.game.gameState

    // draw pause pic
    if (this.game.paused) {
      let y = 4 * this.rVideo.scale
      if (!this.autoMap.active) {
        y += this.rendering.viewWindowY
      }
      const width = 68 * this.rVideo.scale
      const x = this.rendering.viewWindowX +
        (this.rendering.viewWidth - width) / 2
      this.rVideo.drawPatch(x, y, 0,
        this.wad.cacheLumpName('M_PAUSE', Patch))
    }

    // menus go directly to the screen
    // menu is drawn even on top of everything
    this.menu.drawer()
    // send out any new accumulation
    this.net.netUpdate()

    // normal update
    if (!wipe) {
      // page flip or blit buffer
      this.iVideo.finishUpdate()
      return
    }

    // wipe update
    this.wipe.endScreen(0, 0, this.rVideo.width, this.rVideo.height)

    this.wipeActive = true
    this.wipeStart = getTime() - 1
  }

  private wipeActive = false
  private wipeStart = 0

  private displayWipe(): void {
    let nowTime = getTime()
    let tics = 0

    let done = false

    do {
      nowTime = getTime()
      tics = nowTime - this.wipeStart
    } while (!tics)
    this.wipeStart = nowTime

    done = this.wipe.screenWipe(0, 0,
      this.rVideo.width, this.rVideo.height, tics * this.rVideo.scale)

    // menu is drawn even on top of wipes
    this.menu.drawer()
    this.iVideo.finishUpdate()

    if (done) {
      this.wipeActive = false
    }
  }

  //
  // D-DoomLoop()
  // Not a globally visible function,
  //  just included for source reference,
  //  called by D_DoomMain, never exits.
  // Manages timing and IO,
  //  calls all ?_Responder, ?_Ticker, and ?_Drawer,
  //  calls I_GetTime, I_StartFrame, and I_StartTic
  //
  private doomLoop(): void {
    if (this.game.demoRecording) {
      this.game.beginRecording()
    }
    this.iVideo.init()
    if (this.params.input) {
      this.input.init(this.params.input)
    }

    const w = () => {
      this.stats?.begin()
      try {
        if (this.quitted) {
          return
        }

        if (this.wipeActive) {
          this.displayWipe()
          requestAnimationFrame(w.bind(this))
          return
        }

        // process one or more tics
        if (this.singleTics) {
          this.input.startTic()
          this.processEvents()
          this.game.buildTicCmd(
            this.net.netCmds[this.game.consolePlayer][this.net.makeTic],
          )
          if (this.advancedemo) {
            this.doAdvanceDemo()
          }
          this.menu.ticker()
          this.game.ticker()
          this.game.gameTic++
          this.net.makeTic++
        } else {
          // will run at least one tic
          this.net.tryRunTics()
        }

        // move positional sounds
        this.dSound.updateSounds(this.game.player.mo)

        // Update display, next frame, with current state.
        this.display()

        // Sound mixing for the buffer is snychronous.
        this.iSound.updateSound()
      } catch (e) {
        this.onError(e)
      }
      requestAnimationFrame(w.bind(this))
      this.stats?.end()
    }
    w()
  }

  //
  //  DEMO LOOP
  //
  private demoSequence = -1
  private pageTic = -1
  private pageName = ''

  //
  // D_PageTicker
  // Handles timing for warped projection
  //
  pageTicker(): void {
    if (--this.pageTic < 0) {
      this.advanceDemo()
    }
  }

  //
  // D_PageDrawer
  //
  private pageDrawer(): void {
    const patch = this.wad.cacheLumpName(this.pageName, Patch)
    const scale = this.rVideo.scale
    const x = (this.rVideo.width - SCREENWIDTH * scale) / 2
    const y = (this.rVideo.height - SCREENHEIGHT * scale) / 2
    this.rVideo.drawPatch(x, y, 0, patch)
  }

  //
  // D_AdvanceDemo
  // Called after each demo or intro demosequence finishes
  //
  advanceDemo(): void {
    this.advancedemo = true
  }

  //
  // This cycles through the demo sequences.
  // FIXME - version dependend demo numbers?
  //
  doAdvanceDemo(): void {
    // not reborn
    this.game.player.playerState = PlayerState.Live
    this.advancedemo = false
    // no save / end game here
    this.game.userGame = false
    this.game.paused = false
    this.game.gameAction = GameAction.Nothing

    this.demoSequence = (this.demoSequence + 1) % this.instance.demoSequenceCount

    switch (this.demoSequence) {
    case 0:
      if (this.instance.mode === GameMode.Commercial) {
        this.pageTic = 35 * 11
      } else {
        this.pageTic = 170
      }
      this.game.gameState = GameState.DemoScreen
      this.pageName = 'TITLEPIC'
      if (this.instance.mode === GameMode.Commercial) {
        this.dSound.startMusic(MusicName.Dm2ttl)
      } else {
        this.dSound.startMusic(MusicName.Intro)
      }
      break
    case 1:
      this.game.deferedPlayDemo('demo1')
      break
    case 2:
      this.pageTic = 200
      this.game.gameState = GameState.DemoScreen
      this.pageName = 'CREDIT'
      break
    case 3:
      this.game.deferedPlayDemo('demo2')
      break
    case 4:
      this.game.gameState = GameState.DemoScreen
      if (this.instance.mode === GameMode.Commercial) {
        this.pageTic = 35 * 11
        this.pageName = 'TITLEPIC'
        this.dSound.startMusic(MusicName.Dm2ttl)
      } else {
        this.pageTic = 200

        this.pageName = this.instance.creditPatch
      }
      break
    case 5:
      this.game.deferedPlayDemo('demo3')
      break
    case 6:
      // THE DEFINITIVE DOOM Special Edition demo
      this.game.deferedPlayDemo('demo4')
      break
    }
  }

  //
  // D_StartTitle
  //
  startTitle(): void {
    this.game.gameAction = GameAction.Nothing
    this.demoSequence = -1
    this.advanceDemo()
  }

  //
  // D_AddFile
  //
  private addFile(file: string) {
    this.wadfiles.push(file)
  }

  async init(): Promise<void> {
    if (this.quitted) {
      throw 'Can\'t init previously destroyed Doom instance'
    }

    if (this.params.debug && this.params.input) {
      this.gui = new GUI()
      this.game.setupDebugGui(this.gui)

      const stats = new Stats()
      stats.showPanel(0)
      this.params.input.appendChild(stats.dom)
      this.stats = stats
    }

    this.noMonsters = !!this.params.noMonsters
    this.respawnParam = !!this.params.respawn
    this.fastParam = !!this.params.fast
    this.devParam = !!this.params.dev
    if (this.params.altDeath) {
      this.game.deathMatch = 2
    } else if (this.params.deathMatch) {
      this.game.deathMatch = 1
    }

    if (this.devParam) {
      console.log(this.strings.dDevstr)
    }

    // start the apropriate game based on parms
    const recordDemo = this.params.record
    if (recordDemo) {
      this.game.recordDemo(recordDemo)
      this.autoStart = true
    }

    let playDemo = this.params.playDemo
    if (playDemo) {
      if (playDemo.toLowerCase().endsWith('.lmp')) {
        this.addFile(playDemo)
        console.log(`Playing demo ${playDemo}`)
        playDemo = playDemo.substr(0, playDemo.length - 4)
      } else if (playDemo === playDemo.toUpperCase()) {
        this.addFile(`${playDemo}.LMP`)
        console.log(`Playing demo ${playDemo}.LMP`)
      } else {
        this.addFile(`${playDemo}.lmp`)
        console.log(`Playing demo ${playDemo}.lmp`)
      }
    }

    console.log('M_LoadDefaults: Load system defaults.')
    // load before initing other systems
    await this.defaults.load(this.params.config)

    this.addFile(this.params.iwad)

    if (this.params.pwads) {
      this.params.pwads.forEach(f => this.addFile(f))
    }

    console.log('W_Init: Init WADfiles.')
    await this.wad.initMultipleFiles(this.wadfiles)

    // Now that we've loaded the IWAD, we can figure out what gamemission
    // we're playing and which version of Vanilla Doom we need to emulate.
    this.instance = new GameInstance(this.params, this.wad)

    // get skill / episode / map from parms
    this.startSkill = Skill.Medium
    this.startEpisode = 1
    this.startMap = 1
    this.autoStart = false

    if (this.params.skill !== undefined) {
      this.startSkill = this.params.skill
      this.autoStart = true
    }
    if (this.params.episode !== undefined) {
      this.startEpisode = this.params.episode
      this.autoStart = true
    }
    if (this.params.map !== undefined) {
      this.startMap = this.params.map
      this.autoStart = true
    }


    // Check and print which version is executed.
    switch (this.instance.mode) {
    case GameMode.Shareware:
    case GameMode.Indetermined:
      console.log('===========================================================================')
      console.log('                                Shareware!')
      console.log('===========================================================================')
      break
    case GameMode.Registered:
    case GameMode.Retail:
    case GameMode.Commercial:
      console.log('===========================================================================')
      console.log('                 Commercial product - do not distribute!')
      console.log('         Please report software piracy to the SPA: 1-800-388-PIR8')
      console.log('===========================================================================')
      break
    default:
      // Ouch.
      break
    }

    console.log('M_Init: Init miscellaneous info.')
    this.menu.init()

    console.log('R_Init: Init DOOM refresh daemon - ')
    this.rData.initData()
    if (this.params.renderingMode !== undefined) {
      this.renderingMode = this.params.renderingMode
    }
    if (this.params.resolutionWidth !== undefined) {
      this.rVideo.physicalWidth = this.params.resolutionWidth
    }
    if (this.params.resolutionHeight !== undefined) {
      this.rVideo.physicalHeight = this.params.resolutionHeight
    }
    if (this.params.scale !== undefined) {
      this.rVideo.scale = this.params.scale
    }
    this.rVideo.init()
    switch (this.renderingMode) {
    case RenderingMode.Legacy:
      await this.setLegacyRenderer()
      break
    case RenderingMode.WebGL:
      await this.setWebGLRenderer()
      break
    }

    console.log('P_Init: Init Playloop state.')
    this.play.init()

    console.log('I_Init: Setting up machine state.')
    this.iSound.init()

    console.log('D_CheckNetGame: Checking network game status.')
    this.net.checkNetGame()

    console.log('S_Init: Setting up sound')
    this.dSound.init(this.dSound.sfxVolume, this.dSound.musicVolume)

    console.log('HU_Init: Setting up heads up display.')
    this.headsUp.init()

    console.log('ST_Init: Init status bar.')
    this.statusBar.init()

    if (playDemo) {
      // quit after one demo
      this.game.singleDemo = true
      this.game.deferedPlayDemo(playDemo)
      // never returns
      return this.doomLoop()
    }

    if (this.game.gameAction !== GameAction.LoadGame) {
      if (this.autoStart) {
        this.game.initNew(
          this.startSkill, this.startEpisode, this.startMap,
        )
      } else {
        // start up intro loop
        this.startTitle()
      }
    }

    this.doomLoop()
  }

  private quitted = false
  quit(): void {
    if (this.quitted) {
      return
    }

    this.quitted = true

    this.iSound.quit()

    const { width, height } = this.iVideo
    this.iVideo.quit()
    this.iVideo = new BlankVideo()
    this.iVideo.setSize(width, height)

    this.rendering = new BlankRenderer()

    this.input.quit()

    try {
      if (this.params.screen2d) {
        const endoom = this.wad.cacheLumpName('ENDOOM')
        displayEndoom(endoom, this.params.screen2d)
      }
    } catch { /* */ }

    this.iVideo.screen = null

    this.stats?.dom.remove()
    this.gui?.destroy()

    return
  }
}

