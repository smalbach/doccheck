declare module 'heic-decode' {
  function decode(input: { buffer: Uint8Array | ArrayBuffer }): Promise<{ width: number; height: number; data: Uint8ClampedArray }>;
  export = decode;
}
