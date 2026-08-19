import dgram from 'node:dgram';
import { randomInt } from 'node:crypto';
import { getFlagOrDefault } from '../common/args.js';

const DNS_PORT = 53;
const QUERY_TIMEOUT_MS = 3000;
const TYPE_A = 1;
const CLASS_IN = 1;

export function encodeQuery(hostname: string, id: number): Buffer {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(id, 0);
  header.writeUInt16BE(0x0100, 2); // flags: recursion desired
  header.writeUInt16BE(1, 4); // qdcount = 1

  const labels = hostname.split('.').map((label) => {
    const buf = Buffer.from(label, 'ascii');
    return Buffer.concat([Buffer.from([buf.length]), buf]);
  });
  const qname = Buffer.concat([...labels, Buffer.from([0])]);

  const qtypeQclass = Buffer.alloc(4);
  qtypeQclass.writeUInt16BE(TYPE_A, 0);
  qtypeQclass.writeUInt16BE(CLASS_IN, 2);

  return Buffer.concat([header, qname, qtypeQclass]);
}

function skipName(buf: Buffer, offset: number): number {
  while (true) {
    const len = buf[offset];
    if (len === undefined) throw new Error('truncated DNS name');
    if ((len & 0xc0) === 0xc0) return offset + 2; // compression pointer: always 2 bytes
    if (len === 0) return offset + 1; // root label
    offset += 1 + len;
  }
}

export interface DnsAnswer {
  address: string;
  ttl: number;
}

export function decodeResponse(buf: Buffer, expectedId: number): DnsAnswer[] {
  if (buf.length < 12) throw new Error('DNS response too short');

  const id = buf.readUInt16BE(0);
  if (id !== expectedId) throw new Error('DNS response id mismatch');

  const flags = buf.readUInt16BE(2);
  const rcode = flags & 0x000f;
  if (rcode !== 0) throw new Error(`DNS server returned error code ${rcode}`);

  const qdcount = buf.readUInt16BE(4);
  const ancount = buf.readUInt16BE(6);

  let offset = 12;
  for (let i = 0; i < qdcount; i++) {
    offset = skipName(buf, offset);
    offset += 4; // qtype + qclass
  }

  const answers: DnsAnswer[] = [];
  for (let i = 0; i < ancount; i++) {
    offset = skipName(buf, offset);
    const type = buf.readUInt16BE(offset);
    const ttl = buf.readUInt32BE(offset + 4);
    const rdlength = buf.readUInt16BE(offset + 8);
    const rdataOffset = offset + 10;

    if (type === TYPE_A && rdlength === 4) {
      const address = `${buf[rdataOffset]}.${buf[rdataOffset + 1]}.${buf[rdataOffset + 2]}.${buf[rdataOffset + 3]}`;
      answers.push({ address, ttl });
    }

    offset = rdataOffset + rdlength;
  }

  return answers;
}

export function rawDnsQuery(hostname: string, server = '8.8.8.8'): Promise<DnsAnswer[]> {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    const id = randomInt(0, 65536);
    const query = encodeQuery(hostname, id);
    let settled = false;

    const cleanup = () => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        socket.close();
      }
    };

    const timer = setTimeout(() => {
      if (settled) return;
      cleanup();
      reject(new Error(`DNS query to ${server} timed out after ${QUERY_TIMEOUT_MS}ms`));
    }, QUERY_TIMEOUT_MS);

    socket.on('message', (msg) => {
      if (settled) return;
      cleanup();
      try {
        resolve(decodeResponse(msg, id));
      } catch (err) {
        reject(err);
      }
    });

    socket.on('error', (err) => {
      if (settled) return;
      cleanup();
      reject(err);
    });

    socket.send(query, DNS_PORT, server);
  });
}

export async function runRawCommand(args: string[]): Promise<void> {
  const [hostname] = args;
  if (!hostname) {
    console.error('Usage: mini-net dns raw <hostname> [--server <ip>]');
    return;
  }
  const server = getFlagOrDefault(args, '--server', '8.8.8.8');
  const answers = await rawDnsQuery(hostname, server);
  if (answers.length === 0) {
    console.log(`${hostname}: no A records in response (may be CNAME-only)`);
    return;
  }
  for (const a of answers) {
    console.log(`${hostname} -> ${a.address} (ttl ${a.ttl}s)`);
  }
}
