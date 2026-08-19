import net from 'node:net';
import { performance } from 'node:perf_hooks';
import { getFlagOrDefault } from '../common/args.js';

export interface PingResult {
  attempt: number;
  rttMs: number | null;
  error?: string;
}

export function tcpPingOnce(host: string, port: number, timeoutMs = 3000): Promise<number> {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const socket = net.createConnection({ host, port, timeout: timeoutMs });

    socket.on('connect', () => {
      const rtt = performance.now() - start;
      socket.destroy();
      resolve(rtt);
    });
    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error(`connection to ${host}:${port} timed out after ${timeoutMs}ms`));
    });
    socket.on('error', (err) => reject(err));
  });
}

export async function tcpPing(host: string, port: number, count: number): Promise<PingResult[]> {
  const results: PingResult[] = [];
  for (let attempt = 1; attempt <= count; attempt++) {
    try {
      const rttMs = await tcpPingOnce(host, port);
      results.push({ attempt, rttMs });
    } catch (err) {
      results.push({ attempt, rttMs: null, error: (err as Error).message });
    }
  }
  return results;
}

export function summarize(results: PingResult[]): { min: number; avg: number; max: number; lost: number } | null {
  const rtts = results.map((r) => r.rttMs).filter((v): v is number => v !== null);
  if (rtts.length === 0) return null;
  return {
    min: Math.min(...rtts),
    avg: rtts.reduce((a, b) => a + b, 0) / rtts.length,
    max: Math.max(...rtts),
    lost: results.length - rtts.length,
  };
}

export async function runPingCommand(args: string[]): Promise<void> {
  const [host] = args;
  if (!host) {
    console.error('Usage: mini-net ping <host> [--port <n>] [--count <n>]');
    return;
  }
  const port = Number(getFlagOrDefault(args, '--port', '80'));
  const count = Number(getFlagOrDefault(args, '--count', '4'));

  const results = await tcpPing(host, port, count);
  for (const r of results) {
    if (r.rttMs !== null) {
      console.log(`attempt ${r.attempt}: connected to ${host}:${port} in ${r.rttMs.toFixed(1)}ms`);
    } else {
      console.log(`attempt ${r.attempt}: failed (${r.error})`);
    }
  }
  const summary = summarize(results);
  if (summary) {
    console.log(
      `rtt min/avg/max = ${summary.min.toFixed(1)}/${summary.avg.toFixed(1)}/${summary.max.toFixed(1)} ms, ${summary.lost}/${results.length} lost`,
    );
  } else {
    console.log('all attempts failed');
  }
}
