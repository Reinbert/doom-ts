/** [MDN Reference](https://developer.mozilla.org/docs/Web/API/KeyboardLayoutMap) */
interface KeyboardLayoutMap extends ReadonlyMap<string, string> {
}

/**
 * Available only in secure contexts.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Keyboard)
 */
interface Keyboard {
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/Keyboard/getLayoutMap) */
  getLayoutMap(): Promise<KeyboardLayoutMap>;

  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/Keyboard/lock) */
  lock(keyCodes?: string[]): Promise<undefined>;

  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/Keyboard/unlock) */
  unlock(): void;
}

declare interface Navigator {
  readonly keyboard?: Keyboard;
}
