declare module 'picomatch' {
  interface PicomatchOptions {
    dot?: boolean;
    nocase?: boolean;
    [key: string]: unknown;
  }
  type Matcher = (str: string) => boolean;
  function picomatch(pattern: string | string[], options?: PicomatchOptions): Matcher;
  namespace picomatch {}
  export = picomatch;
}
