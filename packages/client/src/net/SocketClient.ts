import {
  parseServerMessage,
  type ClientMessage,
  type ServerMessage,
  type ServerMessageOf,
} from '@match3/shared';

export type ConnectionStatus = 'connecting' | 'online' | 'offline';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type RequestMessage = Extract<ClientMessage, { reqId: number }>;

interface Pending {
  resolve: (msg: ServerMessage) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const PING_INTERVAL_MS = 10_000;
const DEAD_AFTER_MS = 25_000;

/**
 * WebSocket client with:
 *  - automatic reconnect with exponential backoff and jitter;
 *  - request/response on top of WS (correlation by reqId, with a timeout);
 *  - heartbeat: if the server has been silent too long, the connection is considered dead;
 *  - reconnect right away when the network comes back (`online` event).
 */
export class SocketClient {
  private ws: WebSocket | null = null;
  private status: ConnectionStatus = 'offline';
  private attempt = 0;
  private reqId = 0;
  private lastMessageAt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  private readonly pending = new Map<number, Pending>();
  private readonly messageListeners = new Set<(msg: ServerMessage) => void>();
  private readonly statusListeners = new Set<(s: ConnectionStatus) => void>();

  constructor(private readonly url: string) {}

  connect(): void {
    this.stopped = false;
    window.addEventListener('online', this.handleNetworkOnline);
    this.open();
  }

  close(): void {
    this.stopped = true;
    window.removeEventListener('online', this.handleNetworkOnline);
    this.clearTimers();
    this.ws?.close();
    this.ws = null;
    this.setStatus('offline');
  }

  get connectionStatus(): ConnectionStatus {
    return this.status;
  }

  onMessage(fn: (msg: ServerMessage) => void): () => void {
    this.messageListeners.add(fn);
    return () => this.messageListeners.delete(fn);
  }

  onStatus(fn: (s: ConnectionStatus) => void): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  send(msg: ClientMessage): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  /** Sends a message and waits for the response of type `expect` with the same reqId. */
  request<T extends ServerMessage['type']>(
    msg: DistributiveOmit<RequestMessage, 'reqId'>,
    expect: T,
    timeoutMs = 3000,
  ): Promise<ServerMessageOf<T>> {
    const reqId = ++this.reqId;
    return new Promise((resolve, reject) => {
      if (!this.send({ ...msg, reqId } as RequestMessage)) {
        reject(new Error('offline'));
        return;
      }
      const timer = setTimeout(() => {
        this.pending.delete(reqId);
        reject(new Error('timeout'));
      }, timeoutMs);
      this.pending.set(reqId, {
        timer,
        reject,
        resolve: (res) => {
          if (res.type === expect) resolve(res as ServerMessageOf<T>);
          else reject(new Error(res.type === 'error' ? res.message : `unexpected ${res.type}`));
        },
      });
    });
  }

  // ---------- internals ----------

  private open(): void {
    if (this.stopped) return;
    this.setStatus('connecting');
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () => {
      this.attempt = 0;
      this.lastMessageAt = Date.now();
      this.setStatus('online');
      this.pingTimer = setInterval(this.heartbeat, PING_INTERVAL_MS);
    };

    ws.onmessage = (event) => {
      this.lastMessageAt = Date.now();
      const msg = parseServerMessage(String(event.data));
      if (!msg) return;
      if ('reqId' in msg && typeof msg.reqId === 'number') {
        const p = this.pending.get(msg.reqId);
        if (p) {
          clearTimeout(p.timer);
          this.pending.delete(msg.reqId);
          p.resolve(msg);
        }
      }
      this.messageListeners.forEach((fn) => fn(msg));
    };

    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.clearTimers();
      this.failPending();
      this.setStatus('offline');
      this.scheduleReconnect();
    };

    ws.onerror = () => ws.close();
  }

  private readonly heartbeat = () => {
    if (Date.now() - this.lastMessageAt > DEAD_AFTER_MS) {
      // A "half-open" connection: the socket looks open, but nothing arrives.
      this.ws?.close();
      return;
    }
    this.send({ type: 'ping' });
  };

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const base = Math.min(15_000, 500 * 2 ** this.attempt);
    const delay = base / 2 + Math.random() * (base / 2); // jitter: clients do not reconnect all at once
    this.attempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }

  private readonly handleNetworkOnline = () => {
    if (this.status !== 'offline') return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.attempt = 0;
    this.open();
  };

  private failPending(): void {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error('disconnected'));
    }
    this.pending.clear();
  }

  private clearTimers(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private setStatus(s: ConnectionStatus): void {
    if (this.status === s) return;
    this.status = s;
    this.statusListeners.forEach((fn) => fn(s));
  }
}
