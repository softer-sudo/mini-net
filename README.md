# mini-net

A tiny Node.js + TypeScript CLI that demonstrates networking fundamentals —
TCP, UDP, TLS, DNS, and latency measurement — using nothing but Node's
built-in `net`, `dgram`, `tls`, `dns`, and `child_process` modules. Every
sub-command is a small, self-contained example of one networking concept
you can read start to finish in a single file, not a production framework.

## 1. What this is

`mini-net` bundles six sub-commands behind one CLI entry point: a
multi-client TCP chat room, the same chat protocol re-implemented over UDP,
the same chat protocol again over TLS with certificate verification, a DNS
resolver (both the "normal" built-in way and a hand-rolled raw UDP query),
and a pair of latency tools (TCP-connect ping and a traceroute-style hop
counter). The point of the project is pedagogical: each command exists to
make one layer of the network stack, or one trade-off between protocols,
concrete and runnable, and the code is written to be read.

It is explicitly **not** a production chat server or resolver. There is no
authentication, no persistence, no rooms or usernames, no CLI framework
(argument parsing is hand-rolled `process.argv` scanning), and no real
ICMP-based ping/traceroute — Node has no raw-socket API without root
privileges or a native addon, so the latency tools approximate what `ping`
and `traceroute` measure using TCP-connect timing and by shelling out to the
OS's own `traceroute`/`tracert` binary. Those simplifications are called out
explicitly below rather than hidden.

## 2. Install & run

```bash
# 1. Install dependencies (TypeScript, tsx, @types/node — no runtime deps)
npm install

# 2. Generate a self-signed TLS certificate (only needed before using tls-chat).
#    Shells out to the system `openssl`; writes certs/server.{key,cert} (gitignored).
npm run gen-cert

# 3. Build the TypeScript sources to dist/
npm run build

# 4. Run any command against the compiled output
node dist/cli.js <command> [options]

# ...or iterate without building, via tsx:
npm run dev -- <command> [options]

# Run the test suite (Node's built-in test runner, via tsx — no jest/vitest)
npm test
```

`node dist/cli.js` (or `mini-net` if installed as a bin) with no arguments,
or `--help`/`-h`, prints the full command usage.

## 3. Commands

| Command | Demonstrates | Example |
|---|---|---|
| `tcp-chat server` / `tcp-chat client` | Connection-oriented, ordered, reliable multi-client broadcast over TCP | `node dist/cli.js tcp-chat server --port 4000`<br>`node dist/cli.js tcp-chat client --host localhost --port 4000` |
| `udp-messenger server` / `udp-messenger client` | Connectionless, best-effort, one-shot datagrams (connected-mode `dgram`) | `node dist/cli.js udp-messenger server --port 5000`<br>`node dist/cli.js udp-messenger client --host localhost --port 5000` |
| `tls-chat server` / `tls-chat client` | The same chat protocol over an encrypted, certificate-verified TCP connection | `node dist/cli.js tls-chat server --port 4443`<br>`node dist/cli.js tls-chat client --host localhost --port 4443` |
| `dns lookup <hostname>` | The "normal" resolution path via Node's built-in stub resolver | `node dist/cli.js dns lookup example.com` |
| `dns raw <hostname> [--server <ip>]` | DNS as a single hand-encoded UDP request/response, no library help | `node dist/cli.js dns raw example.com --server 8.8.8.8` |
| `ping <host> [--port <n>] [--count <n>]` | Round-trip time via repeated TCP-connect handshakes (not ICMP echo) | `node dist/cli.js ping example.com --port 443 --count 4` |
| `traceroute <host> [--port <n>]` | TCP-connect RTT plus OS-level hop count (shells out to `traceroute`/`tracert`) | `node dist/cli.js traceroute example.com` |

Defaults: `tcp-chat` port `4000`, `udp-messenger` port `5000`, `tls-chat`
port `4443`, `--host` on all clients is `localhost`, `dns raw --server`
defaults to `8.8.8.8`, `ping`/`traceroute` `--port` defaults to `80`, `ping
--count` defaults to `4`.

Both chat servers broadcast each line to every *other* connected client —
the sender never sees its own message echoed back. Type lines on stdin
after connecting; each line is sent as one message.

## 4. OSI layer map

| Command | Primary layer(s) | Notes |
|---|---|---|
| `tcp-chat` | Transport (L4, TCP) over IP (L3) | `node:net` — a raw byte stream; the framing into "lines" is an application-layer (L7) concern the CLI adds on top. |
| `udp-messenger` | Transport (L4, UDP) over IP (L3) | `node:dgram` — connectionless, no delivery guarantee at this layer. |
| `tls-chat` | Session/Presentation (L5/L6) layered on Transport (L4, TCP) | The TLS handshake (cipher negotiation, certificate validation, session key derivation) is the classic textbook example of L5/L6 concerns riding on top of an L4 TCP stream; the chat "protocol" itself is the same L7-ish line framing as `tcp-chat`. |
| `dns lookup` / `dns raw` | Application (L7), carried over Transport (L4, UDP) | DNS is an application protocol with its own wire format, but that wire format is itself just the payload of a single UDP datagram — L7 sitting directly on L4 with no session layer in between. |
| `ping` / `traceroute` | Conceptually L3 (ICMP), approximated via L4 here | Real `ping`/`traceroute` operate at the network layer using ICMP echo/TTL-expiry, which requires raw sockets. Node has no raw-socket L3 access without root privileges or a native addon, so `ping` substitutes TCP-connect handshake timing (L4) as an RTT proxy, and `traceroute` shells out to the OS's own L3-capable `traceroute`/`tracert` binary for hop count. **This is a deliberate limitation, not an oversight** — it's called out in the code and here so the approximation isn't mistaken for the real thing. |

## 5. TCP vs UDP

TCP is **connection-oriented, ordered, and reliable**: a three-way handshake
(SYN / SYN-ACK / ACK) establishes a connection before any data flows, every
byte is sequenced, and the receiver acknowledges what it gets — the sender
retransmits anything that isn't ACKed in time. That reliability isn't free:
it costs a round trip before the first byte of data can even be sent, and
ongoing ACK/retransmission bookkeeping on both ends.

UDP is **connectionless, unordered, and best-effort**: a datagram is fired
at a destination with no handshake, no sequencing, and no delivery
guarantee. If it's dropped, delayed, or arrives out of order relative to
other datagrams, UDP itself does nothing about it — any reliability has to
be built by the application, if it's needed at all.

`tcp-chat` and `tls-chat` use TCP because chat messages need to arrive
**in the order they were typed** and **not be silently dropped** — losing or
reordering a line of chat is a worse failure mode than the extra handshake
latency. `udp-messenger` and the raw DNS query in `dns raw` use UDP because
each is a **single, self-contained request/response**: there's no ongoing
stream to keep in order, the overhead of a TCP handshake would dwarf the
size of one short message, and the small amount of reliability that's
worth having (DNS's "did I get an answer at all") is handled by the
application itself with its own timeout — `raw-query.ts` sets a 3-second
timer and treats a non-response as a failure, rather than relying on the
transport to retry.

## 6. DNS

Resolving a hostname is a chain of delegated lookups, not one query. In the
common case (and the case both `dns lookup` and `dns raw` ultimately rely
on):

1. **Stub resolver** — a lightweight resolver that doesn't know how to walk
   the DNS hierarchy itself; it just asks a **recursive resolver** (e.g.
   your ISP's or router's DNS server, or an explicit public one like
   `8.8.8.8`) to do the work and hands back whatever answer comes back.
   `dns lookup` uses Node's `dns.resolve4()`, which — unlike the
   OS-facility-based `dns.lookup()` that most Node code actually calls for
   general hostname resolution — bypasses the operating system's own
   resolver and speaks the DNS wire protocol directly (via Node's bundled
   `c-ares` library) to the recursive resolver configured in the system's
   `/etc/resolv.conf`. `dns raw` plays the same stub-resolver role by hand:
   it sends its own hand-encoded query directly to an explicit resolver
   (default `8.8.8.8`) over a raw `dgram` socket, with no library in
   between.
2. The recursive resolver, if it doesn't already have the answer cached,
   asks a **root server** which server is authoritative for the
   top-level domain (`.com`, `.org`, ...).
3. It then asks that **TLD server** which server is authoritative for the
   specific domain (`example.com`).
4. It then asks that **authoritative server** for the actual record
   (e.g. the A record for `example.com`), and caches the answer (subject
   to the record's TTL) before returning it to the original stub resolver.

`dns lookup` hides steps 2-4 entirely: `dns.resolve4()` sends one query to
the configured recursive resolver and gets back a final, already-recursed
answer — the recursive resolver (not Node, not the querying machine) is the
one that walks root → TLD → authoritative and caches the result.

`dns raw` shows what that single stub-to-recursive-resolver hop actually
looks like on the wire: a DNS query is fundamentally **one UDP datagram
out, one UDP datagram back**, sent directly to a single recursive resolver
(default `8.8.8.8`) — `dns raw`, like `dns.resolve4()`, never talks to a
root or TLD server itself; it relies on `8.8.8.8` to have already done that
recursive work. `raw-query.ts`
hand-encodes the request as:

- a fixed **12-byte header** (a 16-bit transaction ID used to match the
  response, flags requesting recursion, and section counts — one question,
  zero answers),
- a **question section**: the hostname split into length-prefixed labels
  (e.g. `example.com` → `\x07example\x03com\x00`), followed by QTYPE (`A`,
  value 1) and QCLASS (`IN`, value 1),

and decodes the response by walking the same structure back: header counts
tell it how many questions and answers to expect, the question section is
skipped, and each answer record is parsed by resolving its name (which is
frequently a **compression pointer** — a 2-byte `0xC0xx` reference back into
an earlier part of the message rather than a repeated literal name, since
the answer's name is usually identical to the question's), then reading the
type, TTL, and RDATA length/value. `dns raw` returns the first `A`-type
record and skips over any `CNAME` records it encounters along the way. A
`setTimeout` rejects the whole operation if no reply arrives within 3
seconds — since UDP has no delivery guarantee, "no response" has to be
handled explicitly rather than assumed away.

## 7. TLS handshake

`tls-chat` runs the exact same line-based chat protocol as `tcp-chat`, but
over `node:tls` instead of `node:net`. Before any chat data flows, the
client and server perform a TLS handshake:

1. **ClientHello** — the client opens a TCP connection and proposes the
   TLS versions and cipher suites it supports.
2. **ServerHello** — the server picks a cipher suite from that list and
   replies, along with **its certificate**.
3. **Certificate validation** — the client checks the server's certificate
   against a trusted certificate authority (CA). In `tls-chat`, that's the
   self-signed cert generated by `scripts/gen-cert.sh`: the client reads
   `certs/server.cert` and passes it as the `ca` option to `tls.connect()`,
   explicitly trusting *that specific certificate* rather than any
   publicly-trusted CA. `rejectUnauthorized` is left at its Node default of
   `true`, so a certificate that doesn't chain to the pinned CA — expired,
   wrong hostname, tampered — still fails the connection closed.
4. **Key exchange** — client and server derive a shared symmetric session
   key (via the negotiated cipher suite's key exchange, e.g.
   ECDHE) without ever transmitting that key itself in the clear.
5. **Application data** — every byte after the handshake, including every
   chat line, is encrypted with that session key. The `secureConnect` event
   in `tls-chat/client.ts` fires once this handshake completes, and the
   code logs `socket.authorized` to show whether certificate validation
   actually passed.

The important thing this demo does **not** do: it never sets
`rejectUnauthorized: false` and never disables verification. Pinning a
specific self-signed CA (rather than trusting a public CA or skipping
verification entirely) is the realistic pattern for private/internal
services — services that will never get a certificate from a public CA but
still shouldn't accept a connection from *any* server with *any*
certificate. `gen-cert.sh` also sets a Subject Alternative Name
(`subjectAltName=DNS:localhost,IP:127.0.0.1`) because modern Node/OpenSSL
ignore the certificate's Common Name field and require a SAN entry
matching the connection target, or the handshake fails with
`ERR_TLS_CERT_ALTNAME_INVALID`.

## 8. Bandwidth, hops, and CDNs vs response time

Three different things get conflated under "network is slow," and they
respond to different fixes:

- **Propagation delay** — the time for a signal to physically travel from
  client to server and back, bounded by the speed of light in the medium.
  This is the dominant cost for round-trip time (RTT) on most
  connections, and it grows with physical distance — which in practice
  shows up as **hop count**: each router a packet passes through adds a
  small amount of its own **queuing and processing delay** on top of the
  propagation delay of that link, so more hops (usually correlated with
  more distance) means a longer RTT.
- **Bandwidth** — how much data can be pushed through the link per second.
  Bandwidth mostly affects the **duration of a transfer**, not the RTT of
  the first byte: a higher-bandwidth link doesn't make a single small
  request arrive back any faster, but it does make downloading a large
  payload (a video, a big JSON blob) finish sooner once bytes start
  flowing. A high-bandwidth, high-latency link (e.g. satellite) can still
  feel slow to *start* responding even though it moves large payloads
  quickly once going.
- **CDNs** reduce perceived response time mostly by attacking the first
  cost, not the second: by serving a request from an edge server that's
  physically closer to the client, a CDN cuts the number of hops and the
  physical round-trip distance, which cuts propagation + per-hop delay
  directly. When the CDN can also serve the response from its own cache,
  it avoids the round trip to the origin server entirely, which is an even
  bigger win than just being closer.

`ping` and `traceroute` in this project are the observable proxies for
exactly these effects: `ping`'s TCP-connect RTT is a direct (if
handshake-flavored, rather than ICMP-echo-flavored) measurement of
propagation + queuing delay to a host, and `traceroute`'s hop count is a
direct measurement of how many routers are on that path — run `ping`
against a nearby server versus one on another continent, or against an
origin server versus its CDN-fronted hostname, and the RTT and hop-count
differences are exactly the effects described above made concrete.

## 9. The vulnerability mitigated: unbounded input → memory-exhaustion DoS

**The vulnerability.** `tcp-chat` and `tls-chat` read from their sockets
and buffer bytes until a newline (`\n`) delimits a complete line. Without a
bound on that buffer, a malicious or simply broken client can exploit this
directly: open a connection and stream bytes that **never contain a
newline**. A naive implementation keeps concatenating every incoming chunk
onto one ever-growing buffer, waiting for a delimiter that never arrives.
A single such connection can be driven to consume arbitrary amounts of
server memory, and a handful of concurrent connections doing the same
thing can exhaust the process's memory entirely — a classic
memory-exhaustion denial-of-service, and one that requires no special
tooling to trigger, just a socket that writes without ever writing `\n`.

**The mitigation.** `src/common/line-framer.ts`'s `LineFramer` class caps
how large an unterminated line is allowed to get: `MAX_LINE_BYTES` (1024
bytes). Every incoming chunk is appended to an internal buffer; each time a
newline is found, everything before it is emitted as a `line` event and
removed from the buffer. But if the buffer's current unterminated content
ever exceeds `MAX_LINE_BYTES` — whether the newline shows up late and the
completed line itself is too long, or no newline shows up at all and the
raw buffer just keeps growing — `LineFramer` emits an `overflow` event
instead of continuing to buffer. Both `tcp-chat` and `tls-chat` listen for
`overflow` and respond by writing a short error line to the offending
client and then destroying that socket (`socket.destroy()`), which frees
the buffered memory and drops the connection. The failure mode changes
from "this connection can grow forever" to "this connection is cut off
within 1024 bytes of misbehavior."

**Scope limit.** This guard is deliberately narrow, and that's worth
stating explicitly rather than implying the project defends against
denial-of-service in general: `LineFramer` mitigates *exactly one* attack
shape — a single connection buffering an unterminated or oversized line.
It does **not** defend against a SYN flood (which exhausts connection
slots before any application-layer byte is ever read), and it does **not**
defend against a distributed flood of many UDP datagrams or many
concurrent TCP connections each individually well-behaved (which exhausts
resources through sheer connection/socket count rather than through one
socket's buffer). Those require different mitigations entirely (SYN
cookies, rate limiting, connection caps, upstream filtering) that this
project doesn't implement — `udp-messenger`'s only defense in the same
spirit is dropping any single datagram over `UDP_MAX_MESSAGE_BYTES` (2000
bytes), which is the UDP-appropriate analog of the same narrow idea, not a
flood defense either.

## 10. Project layout

```
mini-net/
├── package.json, tsconfig.json, README.md, .gitignore
├── scripts/
│   └── gen-cert.sh          # openssl self-signed cert + key → certs/ (gitignored, run via `npm run gen-cert`)
├── certs/                   # generated by gen-cert.sh, gitignored
├── dist/                    # compiled output of `npm run build`, gitignored
├── test/                    # node:test suite, run via `npm test` (tsx --test test)
└── src/
    ├── cli.ts               # entry point: dispatches sub-commands, prints usage/--help
    ├── common/
    │   ├── line-framer.ts    # bounded newline-delimited framing — the anti-DoS guard (section 9)
    │   ├── args.ts           # tiny --flag value parsing helper, no CLI framework
    │   └── stdin-relay.ts    # relays stdin lines into a callback (used by all chat clients)
    ├── tcp-chat/{server,client}.ts   # multi-client broadcast chat over plain TCP
    ├── udp-messenger/{server,client}.ts  # connected-mode UDP messenger
    ├── tls-chat/{server,client}.ts   # same chat protocol, over TLS with a pinned CA
    ├── dns/
    │   ├── lookup.ts          # thin wrapper over Node's built-in dns.resolve4
    │   └── raw-query.ts       # hand-rolled DNS-over-UDP query encoder/decoder
    └── latency/
        ├── tcp-ping.ts        # RTT via net.connect() timing, min/avg/max
        └── traceroute.ts      # tcp-ping RTT + child_process OS traceroute/tracert for hop count
```
