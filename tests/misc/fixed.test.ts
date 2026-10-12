import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { div, mul } from '../../src/doom/misc/fixed.ts'

describe('Fixed', () => {
  describe('mul', () => {
    [
      [ 1, -0x10000, -1 ],
      [ 1, -0x10001, -2 ],
      [ 14680064, 96, 21504 ],
      [ -25, 9429989, -3598 ],
      [ 25, 9429989, 3597 ],
      [ -131072, 9429989, -18859978 ],
      [ 131072, 9429989, 18859978 ],
      [ -170910304, 9429989, 1177483727 ],
    ].forEach(([ a, b, expected ]) => {
      it(`multiplies ${a} by ${b}`, () => {
        assert.equal(mul(a, b), expected)
      })
    })
  })

  describe('div', () => {
    [
      [ -1048576, -1048576, 65536 ],
      [ -1048576, 1048576, -65536 ],
      [ 10485760, 100663296, 6826 ],
      [ 25, 9437184, 0 ],
      [ 123456789, 0, 2147483647 ],
      [ 1073741824, 0, 2147483647 ],
      [ -1073741824, 0, -2147483648 ],
      [ 1073741824, 1, 2147483647 ],
      [ 0, 1073741824, 0 ],
    ].forEach(([ a, b, expected ]) => {
      it(`divides ${a} by ${b}`, () => {
        assert.equal(div(a, b), expected)
      })
    })
  })
})
