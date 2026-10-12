import { ANG180, ANGLE_TO_FINE_SHIFT, FINE_ANGLES, fineSine } from '../misc/table'
import { FRACBITS, FRACUNIT, div, mul } from '../misc/fixed'
import { MAP_BLOCK_SHIFT, MAX_RADIUS, PT_ADD_LINES, PT_ADD_THINGS, USE_RANGE } from './local'
import { BBox } from '../misc/bbox'
import { Sound as DSound } from '../doom/sound'
import { Doom } from '../doom'
import { Game } from '../game/game'
import { GameVersion } from '../doom/mode'
import { Inter } from './inter'
import { Intercept } from './map-utils/intercept'
import { Level } from '../level/level'
import { Line } from '../rendering/defs/line'
import { MObj } from './mobj/mobj'
import { MObjFlag } from './mobj/mobj-flag'
import { MObjHandler } from './mobj-handler'
import { MObjType } from '../doom/info/mobj-type'
import { MapLineFlag } from '../doom/data'
import { MapUtils } from './map-utils'
import { Play } from './setup'
import { Player } from '../doom/player'
import { Sector } from '../rendering/defs/sector'
import { SfxName } from '../doom/sounds/sfx-name'
import { Sight } from './sight'
import { SlopeType } from '../rendering/defs/slope-type'
import { Special } from './special'
import { StateNum } from '../doom/info/state-num'
import { Switch } from './switch'
import { Tick } from './tick'
import { pointToAngle } from '../misc/angle'
import { random } from '../misc/random'
import { validCounter } from './valid-counter'

// keep track of special lines as they are hit,
// but don't process them until the move is proven valid
const MAX_SPECIAL_CROSS = 8

export class Map {
  private tmBBox = new BBox()
  private tmThing: MObj | null = null
  private tmFlags = 0
  private tmX = 0
  private tmY = 0

  // If "floatok" true, move would be ok
  // if within "tmfloorz - tmceilingz".
  floatOK = false
  tmFloorZ = 0
  private tmCeilingZ = 0
  private tmDropOffZ = 0

  // keep track of the line that lowers the ceiling,
  // so missiles don't explode against sky hack walls
  ceilingLine: Line | null = null

  specHit = new Array<Line>(MAX_SPECIAL_CROSS)
  numSpecHit = 0

  private get doom(): Doom {
    return this.play.doom
  }
  private get dSound(): DSound {
    return this.play.dSound
  }
  private get game(): Game {
    return this.play.game
  }
  private get inter(): Inter {
    return this.play.inter
  }
  private get level(): Level {
    return this.play.level
  }
  private get mapUtils(): MapUtils {
    return this.play.mapUtils
  }
  private get mObjHandler(): MObjHandler {
    return this.play.mObjHandler
  }
  private get sight(): Sight {
    return this.play.sight
  }
  private get special(): Special {
    return this.play.special
  }
  private get switch(): Switch {
    return this.play.switch
  }
  private get tick(): Tick {
    return this.play.tick
  }
  constructor(private play: Play) { }

  //
  // TELEPORT MOVE
  //

  //
  // PIT_StompThing
  //
  private stompThing(thing: MObj): boolean {
    if (!(thing.flags & MObjFlag.Shootable)) {
      return true
    }

    if (this.tmThing === null) {
      throw 'this.tmThing = null'
    }

    const blockdist = thing.radius + this.tmThing.radius

    if (Math.abs(thing.x - this.tmX) >= blockdist ||
      Math.abs(thing.y - this.tmY) >= blockdist
    ) {
      // didn't hit it
      return true
    }

    // don't clip against self
    if (thing === this.tmThing) {
      return true
    }

    // monsters don't stomp things except on boss level
    if (!this.tmThing.player && this.game.gameMap !== 30) {
      return false
    }

    this.inter.damageMObj(thing, this.tmThing, this.tmThing, 10000)

    return true
  }

  //
  // P_TeleportMove
  //
  teleportMove(thing: MObj, x: number, y: number): boolean {

    // kill anything occupying the position
    this.tmThing = thing
    this.tmFlags = thing.flags

    this.tmX = x
    this.tmY = y

    this.tmBBox

    this.tmBBox.top = y + this.tmThing.radius
    this.tmBBox.bottom = y - this.tmThing.radius
    this.tmBBox.right = x + this.tmThing.radius
    this.tmBBox.left = x - this.tmThing.radius

    const newsubsec = this.level.pointInSubSector(x, y)
    this.ceilingLine = null

    if (newsubsec.sector === null) {
      throw 'newsubsec.sector = null'
    }

    // The base floor/ceiling is from the subsector
    // that contains the point.
    // Any contacted lines the step closer together
    // will adjust them.
    this.tmFloorZ = this.tmDropOffZ = newsubsec.sector.floorHeight
    this.tmCeilingZ = newsubsec.sector.ceilingHeight

    validCounter.inc()
    this.numSpecHit = 0

    // stomp on any things contacted
    const xl = this.tmBBox.left - this.level.blockMap.originX - MAX_RADIUS >> MAP_BLOCK_SHIFT
    const xh = this.tmBBox.right - this.level.blockMap.originX + MAX_RADIUS >> MAP_BLOCK_SHIFT
    const yl = this.tmBBox.bottom - this.level.blockMap.originY - MAX_RADIUS >> MAP_BLOCK_SHIFT
    const yh = this.tmBBox.top - this.level.blockMap.originY + MAX_RADIUS >> MAP_BLOCK_SHIFT

    for (let bx = xl; bx <= xh; bx++) {
      for (let by = yl; by <= yh; by++) {
        if (!this.mapUtils.blockThingsIterator(bx, by, this.stompThing, this)) {
          return false
        }
      }
    }

    // the move is ok,
    // so link the thing into its new position
    this.mapUtils.unsetThingPosition(thing)

    thing.floorZ = this.tmFloorZ
    thing.ceilingZ = this.tmCeilingZ
    thing.x = x
    thing.y = y

    this.mapUtils.setThingPosition(thing)

    return true
  }

  //
  // MOVEMENT ITERATOR FUNCTIONS
  //


  //
  // PIT_CheckLine
  // Adjusts tmfloorz and tmceilingz as lines are contacted
  //
  private checkLine(ld: Line): boolean {
    if (this.tmBBox.right <= ld.bbox.left ||
      this.tmBBox.left >= ld.bbox.right ||
      this.tmBBox.top <= ld.bbox.bottom ||
      this.tmBBox.bottom >= ld.bbox.top
    ) {
      return true
    }

    if (this.mapUtils.boxOnLineSide(this.tmBBox, ld) !== -1) {
      return true
    }

    // A line has been hit

    // The moving thing's destination position will cross
    // the given line.
    // If this should not be allowed, return false.
    // If the line is special, keep track of it
    // to process later if the move is proven ok.
    // NOTE: specials are NOT sorted by order,
    // so two special lines that are only 8 pixels apart
    // could be crossed in either order.

    if (!ld.backSector) {
      // one sided line
      return false
    }

    if (this.tmThing === null) {
      throw 'this.tmThing = null'
    }

    if (!(this.tmThing.flags & MObjFlag.Missile)) {
      if (ld.flags & MapLineFlag.Blocking) {
        // explicitly blocking everything
        return false
      }

      if (!this.tmThing.player && ld.flags & MapLineFlag.BlockMonsters) {
        // block monsters only
        return false
      }
    }

    // set openrange, opentop, openbottom
    this.mapUtils.lineOpening(ld)

    // adjust floor / ceiling heights
    if (this.mapUtils.openTop < this.tmCeilingZ) {
      this.tmCeilingZ = this.mapUtils.openTop
      this.ceilingLine = ld
    }

    if (this.mapUtils.openBottom > this.tmFloorZ) {
      this.tmFloorZ = this.mapUtils.openBottom
    }

    if (this.mapUtils.lowFloor < this.tmDropOffZ) {
      this.tmDropOffZ = this.mapUtils.lowFloor
    }

    // if contacted a special line, add it to the list
    if (ld.special) {
      this.specHit[this.numSpecHit] = ld
      this.numSpecHit++
    }

    return true
  }

  //
  // PIT_CheckThing
  //
  private checkThing(thing: MObj) {
    let solid: boolean

    if (!(thing.flags & (MObjFlag.Solid | MObjFlag.Special | MObjFlag.Shootable))) {
      return true
    }

    if (this.tmThing === null) {
      throw 'this.tmThing = null'
    }

    const blockDist = thing.radius + this.tmThing.radius

    if (Math.abs(thing.x - this.tmX) >= blockDist ||
      Math.abs(thing.y - this.tmY) >= blockDist
    ) {
      // didn't hit it
      return true
    }

    // don't clip against self
    if (thing === this.tmThing) {
      return true
    }

    // check for skulls slamming into things
    if (this.tmThing.flags & MObjFlag.SkullFly) {
      const damage = (random.pRandom() % 8 + 1) * this.tmThing.info.damage

      this.inter.damageMObj(thing, this.tmThing, this.tmThing, damage)

      this.tmThing.flags &= ~MObjFlag.SkullFly
      this.tmThing.momX = this.tmThing.momY = this.tmThing.momZ = 0

      this.mObjHandler.setMObjState(this.tmThing, this.tmThing.info.spawnState)

      // stop moving
      return false
    }

    // missiles can hit other things
    if (this.tmThing.flags & MObjFlag.Missile) {
      // see if it went over / under
      if (this.tmThing.z > thing.z + thing.height) {
        // overhead
        return true
      }
      if (this.tmThing.z + this.tmThing.height < thing.z) {
        // underneath
        return true
      }

      if (this.tmThing.target && (
        this.tmThing.target.type === thing.type ||
        this.tmThing.target.type === MObjType.Knight && thing.type === MObjType.Bruiser ||
        this.tmThing.target.type === MObjType.Bruiser && thing.type === MObjType.Knight)
      ) {
        // Don't hit same species as originator.
        if (thing === this.tmThing.target) {
          return true
        }

        if (thing.type !== MObjType.Player) {
          // Explode, but do no damage.
          // Let players missile other players.
          return false
        }
      }

      if (!(thing.flags & MObjFlag.Shootable)) {
        // didn't do any damage
        return !(thing.flags & MObjFlag.Solid)
      }

      // damage / explode
      const damage = (random.pRandom() % 8 + 1) * this.tmThing.info.damage
      this.inter.damageMObj(thing, this.tmThing, this.tmThing.target, damage)

      // don't traverse any more
      return false
    }

    // check for special pickup
    if (thing.flags & MObjFlag.Special) {
      solid = !!(thing.flags & MObjFlag.Solid)

      if (this.tmFlags & MObjFlag.PickUp) {
        // can remove thing
        this.inter.touchSpecialThing(thing, this.tmThing)
      }
      return !solid
    }

    return !(thing.flags & MObjFlag.Solid)
  }

  //
  // MOVEMENT CLIPPING
  //

  //
  // P_CheckPosition
  // This is purely informative, nothing is modified
  // (except things picked up).
  //
  // in:
  //  a mobj_t (can be valid or invalid)
  //  a position to be checked
  //   (doesn't need to be related to the mobj_t->x,y)
  //
  // during:
  //  special things are touched if MF_PICKUP
  //  early out on solid lines?
  //
  // out:
  //  newsubsec
  //  floorz
  //  ceilingz
  //  tmdropoffz
  //   the lowest point contacted
  //   (monsters won't move to a dropoff)
  //  speciallines[]
  //  numspeciallines
  //
  checkPosition(thing: MObj, x: number, y: number): boolean {
    this.tmThing = thing
    this.tmFlags = thing.flags

    this.tmX = x
    this.tmY = y

    this.tmBBox.top = y + this.tmThing.radius
    this.tmBBox.bottom = y - this.tmThing.radius
    this.tmBBox.right = x + this.tmThing.radius
    this.tmBBox.left = x - this.tmThing.radius

    const newSubSec = this.level.pointInSubSector(x, y)
    this.ceilingLine = null

    if (newSubSec.sector === null) {
      throw 'newSubSec.sector'
    }

    // The base floor / ceiling is from the subsector
    // that contains the point.
    // Any contacted lines the step closer together
    // will adjust them.
    this.tmFloorZ = this.tmDropOffZ =
      newSubSec.sector.floorHeight
    this.tmCeilingZ = newSubSec.sector.ceilingHeight

    validCounter.inc()
    this.numSpecHit = 0

    if (this.tmFlags & MObjFlag.NoClip) {
      return true
    }

    // Check things first, possibly picking things up.
    // The bounding box is extended by MAXRADIUS
    // because mobj_ts are grouped into mapblocks
    // based on their origin point, and can overlap
    // into adjacent blocks by up to MAXRADIUS units.
    let xl = this.tmBBox.left - this.level.blockMap.originX - MAX_RADIUS >> MAP_BLOCK_SHIFT
    let xh = this.tmBBox.right - this.level.blockMap.originX + MAX_RADIUS >> MAP_BLOCK_SHIFT
    let yl = this.tmBBox.bottom - this.level.blockMap.originY - MAX_RADIUS >> MAP_BLOCK_SHIFT
    let yh = this.tmBBox.top - this.level.blockMap.originY + MAX_RADIUS >> MAP_BLOCK_SHIFT
    let bx: number
    let by: number
    for (bx = xl; bx <= xh; ++bx) {
      for (by = yl; by <= yh; ++by) {
        if (!this.mapUtils.blockThingsIterator(bx, by, this.checkThing, this)) {
          return false
        }
      }
    }

    // check lines
    xl = this.tmBBox.left - this.level.blockMap.originX >> MAP_BLOCK_SHIFT
    xh = this.tmBBox.right - this.level.blockMap.originX >> MAP_BLOCK_SHIFT
    yl = this.tmBBox.bottom - this.level.blockMap.originY >> MAP_BLOCK_SHIFT
    yh = this.tmBBox.top - this.level.blockMap.originY >> MAP_BLOCK_SHIFT
    for (bx = xl; bx <= xh; ++bx) {
      for (by = yl; by <= yh; ++by) {
        if (!this.mapUtils.blockLinesIterator(bx, by, this.checkLine, this)) {
          return false
        }
      }
    }

    return true
  }

  //
  // P_TryMove
  // Attempt to move to a new position,
  // crossing special lines unless MObjFlag.MF_TELEPORT is set.
  //
  tryMove(thing: MObj, x: number, y: number): boolean {
    this.floatOK = false

    if (!this.checkPosition(thing, x, y)) {
      // solid wall or thing
      return false
    }

    if (!(thing.flags & MObjFlag.NoClip)) {
      if (this.tmCeilingZ - this.tmFloorZ < thing.height) {
        // doesn't fit
        return false
      }

      this.floatOK = true

      if (!(thing.flags & MObjFlag.Teleport) &&
        this.tmCeilingZ - thing.z < thing.height
      ) {
        // mobj must lower itself to fit
        return false
      }

      if (!(thing.flags & MObjFlag.Teleport) &&
        this.tmFloorZ - thing.z > 24 * FRACUNIT
      ) {
        // too big a step up
        return false
      }

      if (!(thing.flags & (MObjFlag.DropOff | MObjFlag.Float)) &&
        this.tmFloorZ - this.tmDropOffZ > 24*FRACUNIT) {
        // don't stand over a dropoff
        return false
      }
    }

    // the move is ok,
    // so link the thing into its new position
    this.mapUtils.unsetThingPosition(thing)

    const oldX = thing.x
    const oldY = thing.y
    thing.floorZ = this.tmFloorZ
    thing.ceilingZ = this.tmCeilingZ
    thing.x = x
    thing.y = y

    this.mapUtils.setThingPosition(thing)

    let side: 0 | 1
    let oldSide: 0 | 1
    let ld: Line
    // if any special lines were hit, do the effect
    if (!(thing.flags & (MObjFlag.Teleport | MObjFlag.NoClip))) {
      while (this.numSpecHit--) {
        // see if the lien was crossed
        ld = this.specHit[this.numSpecHit]
        side = this.mapUtils.pointOnLineSide(thing.x, thing.y, ld)
        oldSide = this.mapUtils.pointOnLineSide(oldX, oldY, ld)

        if (side !== oldSide) {
          if (ld.special) {
            this.special.crossSpecialLine(
              this.level.lines.indexOf(ld),
              oldSide,
              thing,
            )
          }
        }
      }
    }

    return true
  }

  //
  // P_ThingHeightClip
  // Takes a valid thing and adjusts the thing->floorz,
  // thing->ceilingz, and possibly thing->z.
  // This is called for all nearby monsters
  // whenever a sector changes height.
  // If the thing doesn't fit,
  // the z will be set to the lowest value
  // and false will be returned.
  //
  private thingHeightClip(thing: MObj): boolean {
    const onFloor = thing.z === thing.floorZ

    this.checkPosition(thing, thing.x, thing.y)
    // what about stranding a monster partially off an edge?

    thing.floorZ = this.tmFloorZ
    thing.ceilingZ = this.tmCeilingZ

    if (onFloor) {
      // walking monsters rise and fall with the floor
      thing.z = thing.floorZ
    } else {
      // don't adjust a floating monster unless forced to
      if (thing.z + thing.height > thing.ceilingZ) {
        thing.z = thing.ceilingZ - thing.height
      }
    }

    if (thing.ceilingZ - thing.floorZ < thing.height) {
      return false
    }

    return true
  }

  //
  // SLIDE MOVE
  // Allows the player to slide along any angled walls.
  //
  private bestSlideFrac = 0

  private bestSlideLine: Line | null = null

  private slideMo: MObj | null = null

  private tmXMove = 0
  private tmYMove = 0

  //
  // P_HitSlideLine
  // Adjusts the xmove / ymove
  // so that the next move will slide along the wall.
  //
  private hitSlideLine(ld: Line): void {
    if (ld.slopeType === SlopeType.Horizontal) {
      this.tmYMove = 0
      return
    }
    if (ld.slopeType === SlopeType.Vertical) {
      this.tmXMove = 0
      return
    }

    if (this.slideMo === null) {
      throw 'this.slideMo = null'
    }

    const side = this.mapUtils.pointOnLineSide(
      this.slideMo.x,
      this.slideMo.y,
      ld,
    )

    let lineAngle = pointToAngle(
      0, 0, ld.dX, ld.dY,
    )

    if (side === 1) {
      lineAngle = lineAngle + ANG180 >>> 0
    }

    const moveAngle = pointToAngle(
      0, 0, this.tmXMove, this.tmYMove,
    )

    let deltaAngle = moveAngle - lineAngle >>> 0

    if (deltaAngle > ANG180) {
      deltaAngle = deltaAngle + ANG180 >>> 0
    }

    lineAngle >>>= ANGLE_TO_FINE_SHIFT
    deltaAngle >>>= ANGLE_TO_FINE_SHIFT

    const moveLen = this.mapUtils.aproxDistance(
      this.tmXMove, this.tmYMove,
    )
    const newLen = mul(
      moveLen, fineSine[FINE_ANGLES / 4 + deltaAngle],
    )

    this.tmXMove = mul(newLen, fineSine[FINE_ANGLES / 4 + lineAngle])
    this.tmYMove = mul(newLen, fineSine[lineAngle])
  }

  //
  // PTR_SlideTraverse
  //
  private slideTraverse(inter: Intercept): boolean {
    if (!inter.isALine) {
      throw 'PTR_SlideTraverse: not a line?'
    }
    if (this.slideMo === null) {
      throw 'this.slideMo = null'
    }

    const li = inter.d

    if (!(li.flags & MapLineFlag.TwoSided)) {
      if (this.mapUtils.pointOnLineSide(this.slideMo.x, this.slideMo.y, li)) {
        // don't hit the back side
        return true
      }

      return this.slideTraverseGoToIsBlocking(inter, li)
    }

    // set openrange, opentop, openbottom
    this.mapUtils.lineOpening(li)

    if (this.mapUtils.openRange < this.slideMo.height) {
      // doesn't fit
      return this.slideTraverseGoToIsBlocking(inter, li)
    }

    if (this.mapUtils.openTop - this.slideMo.z < this.slideMo.height) {
      // mobj is too high
      return this.slideTraverseGoToIsBlocking(inter, li)
    }

    if (this.mapUtils.openBottom - this.slideMo.z > 24 * FRACUNIT) {
      // too big a step up
      return this.slideTraverseGoToIsBlocking(inter, li)
    }

    // this line doesn't block movement
    return true
  }
  // the line does block movement,
  // see if it is closer than best so far
  private slideTraverseGoToIsBlocking(inter: Intercept, li: Line): boolean {
    if (inter.frac < this.bestSlideFrac) {
      this.bestSlideFrac = inter.frac
      this.bestSlideLine = li
    }

    // stop
    return false
  }

  //
  // P_SlideMove
  // The momx / momy move is bad, so try to slide
  // along a wall.
  // Find the first line hit, move flush to it,
  // and slide along it
  //
  // This is a kludgy mess.
  //
  slideMove(mo: MObj): void {
    this.slideMo = mo

    return this.slideMoveGoToRetry(mo, 0)
  }
  private slideMoveGoToRetry(mo: MObj, hitCount: number): void {
    if (++hitCount === 3) {
      // don't loop forever
      return this.slideMoveGoToStairStep(mo)
    }

    let leadX: number
    let leadY: number
    let trailX: number
    let trailY: number

    // trace along the three leading corners
    if (mo.momX > 0) {
      leadX = mo.x + mo.radius
      trailX = mo.x - mo.radius
    } else {
      leadX = mo.x - mo.radius
      trailX = mo.x + mo.radius
    }

    if (mo.momY > 0) {
      leadY = mo.y + mo.radius
      trailY = mo.y - mo.radius
    } else {
      leadY = mo.y - mo.radius
      trailY = mo.y + mo.radius
    }

    this.bestSlideFrac = FRACUNIT + 1

    this.mapUtils.pathTraverse(
      leadX, leadY, leadX + mo.momX, leadY + mo.momY,
      PT_ADD_LINES, this.slideTraverse, this,
    )
    this.mapUtils.pathTraverse(
      trailX, leadY, trailX + mo.momX, leadY + mo.momY,
      PT_ADD_LINES, this.slideTraverse, this,
    )
    this.mapUtils.pathTraverse(
      leadX, trailY, leadX + mo.momX, trailY + mo.momY,
      PT_ADD_LINES, this.slideTraverse, this,
    )

    // move up to the wall
    if (this.bestSlideFrac === FRACUNIT + 1) {
      return this.slideMoveGoToStairStep(mo)
    }

    // fudge a bit to make sure it doesn't hit
    this.bestSlideFrac -= 0x800
    if (this.bestSlideFrac > 0) {
      const newX = mul(mo.momX, this.bestSlideFrac)
      const newY = mul(mo.momY, this.bestSlideFrac)

      if (!this.tryMove(mo, mo.x + newX, mo.y + newY)) {
        return this.slideMoveGoToStairStep(mo)
      }
    }

    // Now continue along the wall.
    // First calculate remainder.
    this.bestSlideFrac = FRACUNIT - (this.bestSlideFrac + 0x800)

    if (this.bestSlideFrac > FRACUNIT) {
      this.bestSlideFrac = FRACUNIT
    }

    if (this.bestSlideFrac <= 0) {
      return
    }

    this.tmXMove = mul(mo.momX, this.bestSlideFrac)
    this.tmYMove = mul(mo.momY, this.bestSlideFrac)

    if (this.bestSlideLine === null) {
      throw 'this.bestSlideLine = null'
    }
    // clip the moves
    this.hitSlideLine(this.bestSlideLine)

    mo.momX = this.tmXMove
    mo.momY = this.tmYMove

    if (!this.tryMove(mo, mo.x + this.tmXMove, mo.y + this.tmYMove)) {
      return this.slideMoveGoToRetry(mo, hitCount)
    }
  }
  private slideMoveGoToStairStep(mo: MObj): void {
    if (!this.tryMove(mo, mo.x, mo.y + mo.momY)) {
      this.tryMove(mo, mo.x + mo.momX, mo.y)
    }
  }

  //
  // P_LineAttack
  //
  // who got hit (or NULL)
  lineTarget: MObj | null = null
  private shootThing: MObj | null = null

  // Height if not aiming up or down
  // ???: use slope for monsters?
  private shootZ = 0

  private laDamage = 0
  attackRange = 0

  private aimSlope = 0

  //
  // PTR_AimTraverse
  // Sets linetaget and aimslope when a target is aimed at.
  //
  private aimTraverse(inter: Intercept): boolean {
    if (inter.isALine) {
      const li = inter.d

      if (!(li.flags & MapLineFlag.TwoSided)) {
        // stop
        return false
      }

      // Crosses a two sided line.
      // A two sided line will restrict
      // the possible target ranges.
      this.mapUtils.lineOpening(li)

      if (this.mapUtils.openBottom >= this.mapUtils.openTop) {
        // stop
        return false
      }

      const dist = mul(this.attackRange, inter.frac)

      if (li.frontSector === null) {
        throw 'li.frontSector = null'
      }
      if (li.backSector === null) {
        throw 'li.backSector = null'
      }

      if (li.frontSector.floorHeight !== li.backSector.floorHeight) {
        const slope = div(this.mapUtils.openBottom - this.shootZ, dist)
        if (slope > this.sight.bottomSlope) {
          this.sight.bottomSlope = slope
        }
      }

      if (li.frontSector.ceilingHeight !== li.backSector.ceilingHeight) {
        const slope = div(this.mapUtils.openTop - this.shootZ, dist)
        if (slope < this.sight.topSlope) {
          this.sight.topSlope = slope
        }
      }

      if (this.sight.topSlope <= this.sight.bottomSlope) {
        // stop
        return false
      }

      // shot continues
      return true
    }

    if (inter.d === null) {
      throw 'inter.d = null'
    }

    // shoot a thing
    const th = inter.d as MObj
    if (th === this.shootThing) {
      // can't shoot self
      return true
    }

    if (!(th.flags & MObjFlag.Shootable)) {
      // corpse or something
      return true
    }

    // check angles to see if the thing can be aimed at
    const dist = mul(this.attackRange, inter.frac)
    let thingTopSlope = div(th.z + th.height - this.shootZ, dist)

    if (thingTopSlope < this.sight.bottomSlope) {
      // shot over the thing
      return true
    }

    let thingBottomSlope = div(th.z - this.shootZ, dist)

    if (thingBottomSlope > this.sight.topSlope) {
      // shot under the thing
      return true
    }

    // this thing can be hit!
    if (thingTopSlope > this.sight.topSlope) {
      thingTopSlope = this.sight.topSlope
    }

    if (thingBottomSlope < this.sight.bottomSlope) {
      thingBottomSlope = this.sight.bottomSlope
    }

    this.aimSlope = (thingTopSlope + thingBottomSlope) / 2 >> 0
    this.lineTarget = th

    // don't go any farther
    return false
  }

  //
  // PTR_ShootTraverse
  //
  private shootTraverse(inter: Intercept): boolean {
    if (inter.isALine) {
      const li = inter.d

      if (li.special) {
        if (this.shootThing === null) {
          throw 'this.shootThing = null'
        }
        this.special.shootSpecialLine(this.shootThing, li)
      }

      if (!(li.flags & MapLineFlag.TwoSided)) {
        return this.shootTraverseGoToHitLine(inter, li)
      }

      // Crosses a two sided line.
      this.mapUtils.lineOpening(li)

      const dist = mul(this.attackRange, inter.frac)

      if (li.frontSector === null) {
        throw 'li.frontSector = null'
      }
      if (li.backSector === null) {
        throw 'li.backSector = null'
      }

      if (li.frontSector.floorHeight !== li.backSector.floorHeight) {
        const slope = div(this.mapUtils.openBottom - this.shootZ, dist)
        if (slope > this.aimSlope) {
          return this.shootTraverseGoToHitLine(inter, li)
        }
      }

      if (li.frontSector.ceilingHeight !== li.backSector.ceilingHeight) {
        const slope = div(this.mapUtils.openTop - this.shootZ, dist)
        if (slope < this.aimSlope) {
          return this.shootTraverseGoToHitLine(inter, li)
        }
      }

      // shot continues
      return true
    }

    if (inter.d === null) {
      throw 'inter.d = null'
    }

    // shoot a thing
    const th = inter.d as MObj
    if (th === this.shootThing) {
      // can't shoot self
      return true
    }

    if (!(th.flags & MObjFlag.Shootable)) {
      // corpse or something
      return true
    }

    // check angles to see if the thing can be aimed at
    const dist = mul(this.attackRange, inter.frac)
    const thingTopSlope = div(th.z + th.height - this.shootZ, dist)

    if (thingTopSlope < this.aimSlope) {
      // shot over the thing
      return true
    }

    const thingBottomSlope = div(th.z - this.shootZ, dist)

    if (thingBottomSlope > this.aimSlope) {
      // shot under the thing
      return true
    }

    // hit thing
    // position a bit closer
    const frac = inter.frac - div(10 * FRACUNIT, this.attackRange)
    const trace = this.mapUtils.trace
    const x = trace.x + mul(trace.dX, frac)
    const y = trace.y + mul(trace.dY, frac)
    const z = this.shootZ + mul(this.aimSlope, mul(frac, this.attackRange))

    // Spawn bullet puffs or blod spots,
    // depending on target type.
    if (inter.d.flags & MObjFlag.NoBlood) {
      this.mObjHandler.spawnPuff(x, y, z)
    } else {
      this.mObjHandler.spawnBlood(x, y, z, this.laDamage)
    }

    if (this.laDamage) {
      this.inter.damageMObj(th, this.shootThing, this.shootThing, this.laDamage)
    }

    // don't go any farther
    return false
  }

  private shootTraverseGoToHitLine(inter: Intercept, li: Line): boolean {
    // hit line

    const frac = inter.frac - div(4 * FRACUNIT, this.attackRange)
    const trace = this.mapUtils.trace
    const x = trace.x + mul(trace.dX, frac)
    const y = trace.y + mul(trace.dY, frac)
    const z = this.shootZ + mul(this.aimSlope, mul(frac, this.attackRange))

    if (li.frontSector === null) {
      throw 'li.frontSector = null'
    }

    if (li.frontSector.ceilingPic === this.level.sky.flatNum) {
      // don't shoot the sky!
      if (z > li.frontSector.ceilingHeight) {
        return false
      }

      // it's a sky hack wall
      if (li.backSector && li.backSector.ceilingPic === this.level.sky.flatNum) {
        return false
      }
    }

    // Spawn bullet puffs.
    this.mObjHandler.spawnPuff(x, y, z)

    // don't go any farther
    return false
  }

  //
  // P_AimLineAttack
  //
  aimLineAttack(t1: MObj, angle: number, distance: number): number {
    angle >>>= ANGLE_TO_FINE_SHIFT
    this.shootThing = t1

    const x2 = t1.x + (distance >> FRACBITS) * fineSine[FINE_ANGLES / 4 + angle]
    const y2 = t1.y + (distance >> FRACBITS) * fineSine[angle]
    this.shootZ = t1.z + (t1.height >> 1) + 8 * FRACUNIT

    // can't shoot outside view angles
    this.sight.topSlope = 100 * FRACUNIT / 160
    this.sight.bottomSlope = -100 * FRACUNIT / 160

    this.attackRange = distance
    this.lineTarget = null

    this.mapUtils.pathTraverse(t1.x, t1.y,
      x2, y2,
      PT_ADD_LINES | PT_ADD_THINGS,
      this.aimTraverse, this)

    if (this.lineTarget) {
      return this.aimSlope
    }

    return 0
  }

  //
  // P_LineAttack
  // If damage == 0, it is just a test trace
  // that will leave linetarget set.
  //
  lineAttack(t1: MObj, angle: number, distance: number,
    slope: number, damage: number,
  ): void {
    angle >>>= ANGLE_TO_FINE_SHIFT
    this.shootThing = t1
    this.laDamage = damage

    const x2 = t1.x + (distance >> FRACBITS) * fineSine[FINE_ANGLES / 4 + angle]
    const y2 = t1.y + (distance >> FRACBITS) * fineSine[angle]
    this.shootZ = t1.z + (t1.height >> 1) + 8 * FRACUNIT

    this.attackRange = distance
    this.aimSlope = slope

    this.mapUtils.pathTraverse(t1.x, t1.y,
      x2, y2,
      PT_ADD_LINES | PT_ADD_THINGS,
      this.shootTraverse, this)
  }


  //
  // USE LINES
  //
  private useThing: MObj | null = null

  private ptrUseTraverse(inter: Intercept) {
    if (!inter.isALine) {
      throw 'inter.isALine = false'
    }
    if (!inter.d.special) {
      this.mapUtils.lineOpening(inter.d)
      if (this.mapUtils.openRange <= 0) {
        this.dSound.startSound(this.useThing, SfxName.Noway)
        // can't use through a wall
        return false
      }
      // not a special line, but keep checking
      return true
    }

    if (this.useThing === null) {
      throw 'this.useThing = null'
    }

    let side: 0 | 1 = 0
    if (this.mapUtils.pointOnLineSide(
      this.useThing.x, this.useThing.y, inter.d) === 1
    ) {
      side = 1
    }

    // return false; // don't use back side

    this.switch.useSpecialLine(this.useThing, inter.d, side)

    // can't use for than one special line in a row
    return false
  }

  //
  // P_UseLines
  // Looks for special lines in front of the player to activate.
  //
  useLines(player: Player): void {
    this.useThing = player.mo

    if (player.mo === null) {
      throw 'player.mo = null'
    }

    const angle = player.mo.angle >>> ANGLE_TO_FINE_SHIFT

    const x1 = player.mo.x
    const y1 = player.mo.y

    const x2 = x1 + (USE_RANGE >> FRACBITS) * fineSine[FINE_ANGLES / 4 + angle]
    const y2 = y1 + (USE_RANGE >> FRACBITS) * fineSine[angle]

    this.mapUtils.pathTraverse(
      x1, y1, x2, y2, PT_ADD_LINES,
      this.ptrUseTraverse, this,
    )

  }

  //
  // RADIUS ATTACK
  //
  private bombSource: MObj | null = null
  private bombSpot: MObj | null = null
  private bombDamage = 0

  //
  // PIT_RadiusAttack
  // "bombsource" is the creature
  // that caused the explosion at "bombspot".
  //
  private pitRadiusAttack(thing: MObj): boolean {
    if (!(thing.flags & MObjFlag.Shootable)) {
      return true
    }

    // Boss spider and cyborg
    // take no damage from concussion.
    if (thing.type === MObjType.Cyborg ||
      thing.type === MObjType.Spider
    ) {
      return true
    }

    if (this.bombSpot === null) {
      throw 'this.bombSpot = null'
    }

    const dX = Math.abs(thing.x - this.bombSpot.x)
    const dY = Math.abs(thing.y - this.bombSpot.y)

    let dist = dX > dY ? dX : dY
    dist = dist - thing.radius >> FRACBITS

    if (dist < 0) {
      dist = 0
    }

    if (dist >= this.bombDamage) {
      // out of range
      return true
    }

    if (this.sight.checkSight(thing, this.bombSpot)) {
      // must be in direct path
      this.inter.damageMObj(thing, this.bombSpot, this.bombSource,
        this.bombDamage - dist)
    }

    return true
  }

  //
  // P_RadiusAttack
  // Source is the creature that caused the explosion at spot.
  //
  radiusAttack(spot: MObj, source: MObj | null, damage: number): void {
    const dist = damage + MAX_RADIUS << FRACBITS

    const yh = spot.y + dist - this.level.blockMap.originY >> MAP_BLOCK_SHIFT
    const yl = spot.y - dist - this.level.blockMap.originY >> MAP_BLOCK_SHIFT
    const xh = spot.x + dist - this.level.blockMap.originX >> MAP_BLOCK_SHIFT
    const xl = spot.x - dist - this.level.blockMap.originX >> MAP_BLOCK_SHIFT

    this.bombSpot = spot
    this.bombSource = source
    this.bombDamage = damage

    for (let y = yl; y <= yh; ++y) {
      for (let x = xl; x <= xh; ++x) {
        this.mapUtils.blockThingsIterator(x, y, this.pitRadiusAttack, this)
      }
    }
  }

  //
  // SECTOR HEIGHT CHANGING
  // After modifying a sectors floor or ceiling height,
  // call this routine to adjust the positions
  // of all things that touch the sector.
  //
  // If anything doesn't fit anymore, true will be returned.
  // If crunch is true, they will take damage
  //  as they are being crushed.
  // If Crunch is false, you should set the sector height back
  //  the way it was and call P_ChangeSector again
  //  to undo the changes.
  //
  private crushChange = false
  private noFit = false

  //
  // PIT_ChangeSector
  //
  pitChangeSector(thing: MObj): boolean {
    if (this.thingHeightClip(thing)) {
      // keep checking
      return true
    }

    // crunch bodies to giblets
    if (thing.health <= 0) {
      this.mObjHandler.setMObjState(thing, StateNum.Gibs)

      if (this.doom.instance.version > GameVersion.Doom12) {
        thing.flags &= ~MObjFlag.Solid
      }
      thing.height = 0
      thing.radius = 0

      // keep checking
      return true
    }

    // crunch dropped items
    if (thing.flags & MObjFlag.Dropped) {
      this.mObjHandler.removeMObj(thing)

      // keep checking
      return true
    }

    if (!(thing.flags & MObjFlag.Shootable)) {
      // assume it is bloody gibs or something
      return true
    }

    this.noFit = true

    if (this.crushChange && !(this.tick.levelTime & 3)) {
      this.inter.damageMObj(thing, null, null, 10)

      // spray blood in a random direction
      const mo = this.mObjHandler.spawnMObj(
        thing.x, thing.y, thing.z + (thing.height / 2 >> 0), MObjType.Blood,
      )

      mo.momX = random.pRandom() - random.pRandom() << 12
      mo.momY = random.pRandom() - random.pRandom() << 12
    }

    // keep checking (crush other things)
    return true
  }

  //
  // P_ChangeSector
  //
  changeSector(sector: Sector, crunch: boolean): boolean {
    let x: number
    let y: number

    this.noFit = false
    this.crushChange = crunch

    // re-check heights for all things near the moving sector
    for (x = sector.blockBox.left; x <= sector.blockBox.right; ++x) {
      for (y = sector.blockBox.bottom; y <= sector.blockBox.top; ++y) {
        this.mapUtils.blockThingsIterator(x, y, this.pitChangeSector, this)
      }
    }

    return this.noFit
  }
}
