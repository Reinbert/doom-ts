/* eslint-disable @typescript-eslint/no-duplicate-enum-values */
//
// Event handling.
//

// Input event types.
export const enum EvType {
  Undefined = -1,
  KeyDown,
  KeyUp,
  Mouse,
  Joystick,
}

// Event structure.
export interface DEvent {
  type: EvType
  // keys / mouse/joystick buttons
  data1: number
  // mouse/joystick x move
  data2: number
  // mouse/joystick y move
  data3: number
}

export const enum GameAction {
  Nothing,
  LoadLevel,
  NewGame,
  LoadGame,
  SaveGame,
  PlayDemo,
  Completed,
  Victory,
  WorldDone,
  Screenshot,
  Pending,
}

//
// Button/action code definitions.
//
export const enum ButtonCode {
  // Press "Fire".
  Attack = 1,
  // Use button, to open doors, activate switches.
  Use = 2,

  // Flag: game events, not really buttons.
  Special = 128,
  SpecialMask = 3,

  // Flag, weapon change pending.
  // If true, the next 3 bits hold weapon num.
  Change = 4,
  // The 3bit weapon mask and shift, convenience.
  WeaponMask = (8 + 16 + 32),
  WeaponShift = 3,

  // Pause the game.
  Pause = 1,
  // Save the game at each console.
  SaveGame = 2,

  // Savegame slot numbers
  //  occupy the second byte of buttons.
  SaveMask = (4 + 8 + 16),
  SaveShift = 2,
}

export const MAX_EVENTS = 64
