import readline from 'node:readline';

export function relayStdinLines(onLine: (line: string) => void): readline.Interface {
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', onLine);
  return rl;
}
