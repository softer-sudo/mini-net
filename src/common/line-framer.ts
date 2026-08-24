import { EventEmitter } from 'node:events';

export const MAX_LINE_BYTES = 1024;

export class LineFramer extends EventEmitter {
  #buffer: Buffer = Buffer.alloc(0);
  readonly #maxBytes: number;
  #overflowed = false;

  constructor(maxBytes: number = MAX_LINE_BYTES) {
    super();
    this.#maxBytes = maxBytes;
  }

  feed(chunk: Buffer): void {
    if (this.#overflowed) return;
    this.#buffer = Buffer.concat([this.#buffer, chunk]);

    let newlineIndex = this.#buffer.indexOf(0x0a);
    while (newlineIndex !== -1) {
      const raw = this.#buffer.subarray(0, newlineIndex);

      // Check if this line exceeds the limit
      if (raw.length > this.#maxBytes) {
        this.#overflowed = true;
        this.#buffer = Buffer.alloc(0);
        this.emit('overflow');
        return; // Stop processing immediately
      }

      this.#buffer = this.#buffer.subarray(newlineIndex + 1);
      const line = raw.toString('utf8').replace(/\r$/, '');
      this.emit('line', line);
      newlineIndex = this.#buffer.indexOf(0x0a);
    }

    if (!this.#overflowed && this.#buffer.length > this.#maxBytes) {
      this.#overflowed = true;
      this.#buffer = Buffer.alloc(0);
      this.emit('overflow');
    }
  }

  reset(): void {
    this.#buffer = Buffer.alloc(0);
    this.#overflowed = false;
  }
}
