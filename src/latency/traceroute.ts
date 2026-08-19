import { execFile } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';
import { tcpPing, summarize } from './tcp-ping.js';
import { getFlagOrDefault } from '../common/args.js';

const execFileAsync = promisify(execFile);
const TRACEROUTE_TIMEOUT_MS = 15_000;

export interface HopResult {
  hopCount: number | null;
  raw: string;
}

export async function countHops(host: string): Promise<HopResult> {
  const isWindows = os.platform() === 'win32';
  const command = isWindows ? 'tracert' : 'traceroute';
  const args = isWindows ? ['-h', '30', host] : ['-m', '30', host];

  try {
    const { stdout } = await execFileAsync(command, args, { timeout: TRACEROUTE_TIMEOUT_MS });
    const hopLines = stdout.split('\n').filter((line) => /^\s*\d+\s/.test(line));
    return { hopCount: hopLines.length, raw: stdout };
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === 'ENOENT') {
      throw new Error(
        `'${command}' is not installed or not on PATH. Install it (Linux: 'apt-get install traceroute'; Windows ships 'tracert' by default) and retry.`,
      );
    }
    throw err;
  }
}

export async function runTracerouteCommand(args: string[]): Promise<void> {
  const [host] = args;
  if (!host) {
    console.error('Usage: mini-net traceroute <host> [--port <n>]');
    return;
  }
  const port = Number(getFlagOrDefault(args, '--port', '80'));

  const pingResults = await tcpPing(host, port, 4);
  const summary = summarize(pingResults);
  if (summary) {
    console.log(
      `tcp rtt min/avg/max = ${summary.min.toFixed(1)}/${summary.avg.toFixed(1)}/${summary.max.toFixed(1)} ms`,
    );
  } else {
    console.log('tcp ping: all attempts failed');
  }

  try {
    const hops = await countHops(host);
    console.log(`hop count: ${hops.hopCount ?? 'unknown'}`);
  } catch (err) {
    console.error(`traceroute failed: ${(err as Error).message}`);
  }
}
