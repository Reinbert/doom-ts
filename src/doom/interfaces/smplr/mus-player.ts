import { CHANNELS, DRUM_CHANNEL, Mus } from '../../doom/sounds/mus';
import { CacheStorage, DrumMachine, Soundfont } from 'smplr';
import { DrumChannel } from './drum-channel';
import { InstruChannel } from './instru-channel';
import { instrumentMap } from './instruments';

const LOOK_AHEAD = 500
const INTERVAL = 250;

export class MusPlayer {
  // TODO "Raptor: Call of the Shadow" should be 70
  readonly ticRate = 140

  private loaded = false
  private playing = false
  private looping = false

  private currentTic = 0
  private currentTime = 0

  private readonly channels = Array.from({ length: CHANNELS }, (_, ch) =>
    ch === DRUM_CHANNEL ? new DrumChannel(this) : new InstruChannel(this))
  private preloadedInstruments: { [k: number]: Soundfont } = []
  private drum?: DrumMachine
  private cache = new CacheStorage()
  private volume = 100

  constructor(
    public audioCtx: AudioContext,
    private mus: Mus,
  ) {}

  async load() {
    if (this.loaded) {
      return
    }
    const { instruments } = this.mus

    const promises: Promise<unknown>[] = []

    let hasDrum = false
    for (let i = 0; i < instruments.length; ++i) {
      const num = instruments[i]
      if (num >= 0 && num <= 127) {
        const instru = this.getInstrument(num)
        promises.push(instru.load)
        this.putInstrument(instru)
      } else if (num >= 135 && num <= 181) {
        hasDrum = true
      }
    }
    if (hasDrum) {
      promises.push(this.getDrum().load)
    }

    await Promise.all(promises)

    const tics = this.mus.byTicsByChannel()
    tics.forEach((tics, ch) => {
      this.channels[ch].tics = tics
    })

    this.loaded = true
  }

  getInstrument(num: number) {
    let instru = this.preloadedInstruments[num]
    if (instru) {
      delete this.preloadedInstruments[num]
      instru.output.setVolume(this.volume)
      return instru
    }

    const instrument = instrumentMap[num]
    instru = new Soundfont(this.audioCtx, {
      instrument,
      storage: this.cache,
      volume: this.volume,
    });

    return instru
  }
  putInstrument(instru?: Soundfont) {
    if (!instru?.config.instrument) {
      return
    }
    const num = instrumentMap.indexOf(instru.config.instrument)
    this.preloadedInstruments[num] = instru
  }
  getDrum() {
    if (this.drum) {
      this.drum.output.setVolume(this.volume)
      return this.drum
    }
    return this.drum = new DrumMachine(this.audioCtx, {
      storage: this.cache,
      volume: this.volume,
      url: 'midi/dm.json',
    })
  }
  setVolume(vol: number) {
    this.volume = vol

    this.channels.forEach(ch => ch.setVolume(vol))
  }

  private ticker() {
    if (!this.loaded || !this.playing) {
      return
    }

    // Avoid stacking too many notes in the queue if too late
    if (this.audioCtx.currentTime - this.currentTime > 0) {
      this.currentTime = this.audioCtx.currentTime
    }

    while (this.currentTime < this.audioCtx.currentTime + LOOK_AHEAD / 1000) {
      this.tick()
    }

    setTimeout(this.ticker.bind(this), INTERVAL)
  }

  private tick() {
    let scoreEnd = false
    this.channels.forEach((ch) => {
      scoreEnd = ch.tick(this.currentTic, this.currentTime) || scoreEnd
    })

    this.currentTic++
    this.currentTime += 1 / this.ticRate

    if (scoreEnd) {
      this.playing = false
    }
    if (scoreEnd && this.looping) {
      setTimeout(() => this.play(true), INTERVAL + LOOK_AHEAD)
    }
  }

  async play(looping: boolean) {
    this.playing = true
    this.looping = looping
    await this.load()

    this.currentTic = 0
    this.currentTime = this.audioCtx.currentTime

    this.ticker()
  }

  pause() {
    this.playing = false
  }
  resume() {
    this.playing = true
    this.currentTime = this.audioCtx.currentTime

    this.ticker()
  }
  stop() {
    this.playing = false
    this.currentTic = 0
  }

}


