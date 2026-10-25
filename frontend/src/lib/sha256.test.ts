import { describe, expect, it } from 'vitest';
import { sha256Hex } from './sha256';

describe('sha256Hex', () => {
  it('hashes strings as UTF-8', () => {
    expect(sha256Hex('ü')).toBe('607474ca475a9724d7360aba71a56d5df77e61350e3f724cfa1f46e857e2d85f');
    expect(sha256Hex('ü')).toBe(sha256Hex(new Uint8Array([0xc3, 0xbc])));
  });

  it('hashes bytes and buffers alike', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(sha256Hex(bytes.buffer)).toBe(sha256Hex(bytes));
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});
