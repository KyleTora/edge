import { describe, it, expect } from 'vitest'
import { greet } from '../src/index.js'

describe('smoke', () => {
  it('greets', () => {
    expect(greet('world')).toBe('hello, world')
  })
})
