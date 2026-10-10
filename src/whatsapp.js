
const path = require("path");
const fs = require("fs");
const pino = require("pino");

const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    DisconnectReason,
    Browsers
} = require("@whiskeysockets/baileys");

class VoltageWhatsApp {
    constructor() {
        this.sock = null;
        this.state = "disconnected";
        this.connectedNumber = null;
        this.pairingCode = null;
        this.pairingNumber = null;
        this.lastError = null;
        this.reconnectTimer = null;
        this.reconnectAttempts = 0;
        this.starting = false;
        this.pairingRequested = false;

        this.authPath = path.join(process.cwd(), "auth");
        this.logger = pino({ level: "silent" });
    }

    async start(number = null) {
        if (number) {
            this.pairingNumber = this.normalizeNumber(number);
        }

        if (this.sock) {
            if (
                this.pairingNumber &&
                !this.pairingRequested &&
                this.state !== "connected"
            ) {
                return this.requestPairingCode();
            }

            return this.getStatus();
        }

        if (this.starting) {
            return this.getStatus();
        }

        this.starting = true;
        this.state = "connecting";

        try {
            fs.mkdirSync(this.authPath, { recursive: true });

            const { state, saveCreds } =
                await useMultiFileAuthState(this.authPath);

            let version;

            try {
                const latest = await fetchLatestBaileysVersion();
                version = latest.version;
            } catch (error) {
                console.error(
                    "[Voltage] Could not fetch Baileys version:",
                    error.message
                );
            }

            const sock = makeWASocket({
                ...(version ? { version } : {}),
                auth: state,
                logger: this.logger,
                browser: Browsers.ubuntu("Chrome"),
                printQRInTerminal: false,
                markOnlineOnConnect: false,
                syncFullHistory: false,
                shouldSyncHistoryMessage: () => false
            });

            this.sock = sock;
            this.pairingRequested = false;

            sock.ev.on("creds.update", saveCreds);

            sock.ev.on("connection.update", (update) => {
                this.handleConnectionUpdate(sock, update);
            });

            sock.ev.on("messages.upsert", async (event) => {
                await this.handleMessages(sock, event);
            });

            console.log("[Voltage] WhatsApp socket created.");
            console.log("[Voltage] WhatsApp events registered.");

            if (!state.creds.registered && this.pairingNumber) {
                await this.requestPairingCode();
            }

            return this.getStatus();
        } catch (error) {
            this.lastError = error.message;
            this.state = "failed";

            console.error(
                "[Voltage] WhatsApp startup failed:",
                error.stack || error
            );

            if (this.sock) {
                try {
                    this.sock.end(undefined);
                } catch {}
                this.sock = null;
            }

            throw error;
        } finally {
            this.starting = false;
        }
    }

    normalizeNumber(value) {
        return String(value || "").replace(/\D/g, "");
    }

    isValidNumber(value) {
        return /^\d{8,15}$/.test(value);
    }

    async requestPairingCode() {
        if (!this.sock) {
            return this.start(this.pairingNumber);
        }

        if (this.state === "connected") {
            return this.getStatus();
        }

        if (this.pairingRequested) {
            return this.getStatus();
        }

        const number = this.normalizeNumber(this.pairingNumber);

        if (!this.isValidNumber(number)) {
            throw new Error(
                "Enter a valid phone number with country code, digits only."
            );
        }

        this.pairingNumber = number;
        this.pairingRequested = true;
        this.state = "pairing";

        try {
            const code = await this.sock.requestPairingCode(number);

            this.pairingCode = String(code).match(/.{1,4}/g)?.join("-")
                || String(code);

            console.log("[Voltage] WhatsApp pairing code generated.");
            console.log("[Voltage] Enter it in WhatsApp Linked Devices.");

            return this.getStatus();
        } catch (error) {
            this.pairingRequested = false;
            this.lastError = error.message;
            this.state = "failed";
            throw error;
        }
    }

    async handleConnectionUpdate(sock, update) {
        if (this.sock !== sock) return;

        const { connection, lastDisconnect } = update;

        if (connection === "connecting") {
            this.state = "connecting";
            console.log("[Voltage] WhatsApp connecting...");
        }

        if (connection === "open") {
            this.state = "connected";
            this.reconnectAttempts = 0;
            this.pairingCode = null;
            this.pairingRequested = false;
            this.lastError = null;

            this.connectedNumber = this.normalizeNumber(
                sock.user?.id?.split(":")[0]?.split("@")[0] || ""
            );

            console.log("[Voltage] WhatsApp connected.");
            console.log(
                `[Voltage] Connected number: ${this.connectedNumber || "unknown"}`
            );
        }

        if (connection === "close") {
            if (this.sock !== sock) return;

            const statusCode =
                lastDisconnect?.error?.output?.statusCode;

            const loggedOut =
                statusCode === DisconnectReason.loggedOut;

            this.sock = null;
            this.connectedNumber = null;
            this.pairingCode = null;
            this.pairingRequested = false;

            if (loggedOut) {
                this.state = "logged_out";
                this.pairingNumber = null;

                console.log(
                    "[Voltage] WhatsApp logged out. Pair again to reconnect."
                );

                return;
            }

            this.state = "disconnected";

            console.error(
                "[Voltage] WhatsApp connection closed:",
                lastDisconnect?.error?.message || "Unknown reason"
            );

            this.scheduleReconnect();
        }
    }

    async handleMessages(sock, event) {
        if (this.sock !== sock) return;

        const messages = Array.isArray(event?.messages)
            ? event.messages
            : [];

        console.log(
            `[Voltage] messages.upsert received: ${messages.length} message(s), type=${event?.type || "unknown"}`
        );

        for (const message of messages) {
            if (!message?.message) continue;
            if (message.key?.fromMe) continue;

            console.log(
                `[Voltage] Incoming message detected from ${message.key?.remoteJid || "unknown"}`
            );

            // Message routing and commands will be added in Stage 3.
        }
    }

    scheduleReconnect() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
        }

        this.reconnectAttempts += 1;

        const delay = Math.min(
            2000 * (2 ** Math.min(this.reconnectAttempts - 1, 4)),
            30000
        );

        console.log(
            `[Voltage] Reconnecting in ${Math.round(delay / 1000)} seconds.`
        );

        this.reconnectTimer = setTimeout(async () => {
            this.reconnectTimer = null;

            try {
                await this.start(this.pairingNumber);
            } catch (error) {
                console.error(
                    "[Voltage] Reconnection failed:",
                    error.message
                );
            }
        }, delay);
    }

    async connect(number) {
        const normalized = this.normalizeNumber(number);

        if (!this.isValidNumber(normalized)) {
            throw new Error(
                "Provide a valid phone number with country code, digits only."
            );
        }

        this.pairingNumber = normalized;

        if (this.sock) {
            if (this.state === "connected") {
                return this.getStatus();
            }

            if (!this.pairingRequested) {
                return this.requestPairingCode();
            }

            return this.getStatus();
        }

        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        return this.start(normalized);
    }

    getStatus() {
        return {
            status: this.state,
            connected: this.state === "connected",
            number: this.connectedNumber,
            pairingCode: this.pairingCode,
            lastError: this.lastError
        };
    }

    async stop() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        const sock = this.sock;
        this.sock = null;
        this.state = "disconnected";
        this.connectedNumber = null;
        this.pairingCode = null;
        this.pairingRequested = false;
        this.pairingNumber = null;

        if (sock) {
            try {
                sock.end(undefined);
            } catch {}
        }

        return this.getStatus();
    }
}

module.exports = new VoltageWhatsApp();
