require("dotenv").config();

const crypto = require("crypto");
const path = require("path");
const express = require("express");

const { router: aiRouter } = require("./ai");
const supportRouter = require("./support");
const whatsapp = require("./whatsapp");

const app = express();

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "32kb" }));

const config = {
    name: process.env.VOLTAGE_NAME || "Voltage",
    owner: process.env.VOLTAGE_OWNER || "Thereal_VoltageLord",
    prefix: process.env.VOLTAGE_PREFIX || ".",
    mode: process.env.VOLTAGE_MODE || "private",
    version: process.env.VOLTAGE_VERSION || "1.0.0"
};

function isAuthorized(req) {
    const expected = process.env.VOLTAGE_PAIRING_SECRET;
    const provided = req.get("x-voltage-secret");

    if (
        typeof expected !== "string" ||
        !expected ||
        typeof provided !== "string" ||
        !provided
    ) {
        return false;
    }

    const expectedBuffer = Buffer.from(expected);
    const providedBuffer = Buffer.from(provided);

    return (
        expectedBuffer.length === providedBuffer.length &&
        crypto.timingSafeEqual(expectedBuffer, providedBuffer)
    );
}

app.get("/", (req, res) => {
    res.set("Cache-Control", "no-store");
    res.sendFile(path.join(__dirname, "../public/index.html"));
});

app.get("/api/health", (req, res) => {
    res.set("Cache-Control", "no-store");

    res.json({
        status: "ok",
        service: config.name,
        uptime: Math.floor(process.uptime()),
        timestamp: new Date().toISOString()
    });
});

app.get("/api/info", (req, res) => {
    res.set("Cache-Control", "no-store");

    res.json({
        name: config.name,
        owner: config.owner,
        prefix: config.prefix,
        mode: config.mode,
        version: config.version,
        aiProviders: ["gemini", "claude"],
        supportAssistant: "Voltage Intelligence",
        whatsapp: whatsapp.getStatus().status
    });
});

app.use("/api/ai", aiRouter);
app.use("/api/support", supportRouter);

app.get("/api/whatsapp/status", (req, res) => {
    res.set("Cache-Control", "no-store");

    res.json({
        status: true,
        whatsapp: whatsapp.getStatus()
    });
});

app.post("/api/whatsapp/pair", async (req, res) => {
    res.set("Cache-Control", "no-store");

    if (!process.env.VOLTAGE_PAIRING_SECRET) {
        return res.status(503).json({
            status: false,
            error: "Pairing is disabled. Configure VOLTAGE_PAIRING_SECRET in Render."
        });
    }

    if (!isAuthorized(req)) {
        return res.status(401).json({
            status: false,
            error: "Invalid gateway access key."
        });
    }

    const number = req.body?.number;

    if (typeof number !== "string" || !number.trim()) {
        return res.status(400).json({
            status: false,
            error: "Enter your WhatsApp phone number, including country code."
        });
    }

    const normalizedNumber = number.replace(/[\s()+-]/g, "");

    if (!/^\d{7,15}$/.test(normalizedNumber)) {
        return res.status(400).json({
            status: false,
            error: "Enter a valid phone number with country code, using digits only."
        });
    }

    try {
        const status = await whatsapp.connect(normalizedNumber);

        return res.json({
            status: true,
            whatsapp: status,
            instructions: status.pairingCode
                ? "Open WhatsApp > Linked devices > Link with phone number and enter the pairing code."
                : "Pairing has started. Check the connection status for updates."
        });
    } catch (error) {
        console.error("[Voltage] Pairing failed:", error.message);

        return res.status(400).json({
            status: false,
            error: error.message || "Could not start WhatsApp pairing."
        });
    }
});

app.use((req, res) => {
    res.status(404).json({
        status: false,
        error: "Route not found.",
        path: req.path
    });
});

app.use((error, req, res, next) => {
    console.error("[Voltage Server]", error.message);

    if (res.headersSent) {
        return next(error);
    }

    const status = error.status === 413
        ? 413
        : error.status === 400
            ? 400
            : 500;

    res.status(status).json({
        status: false,
        error: status === 413
            ? "Request body is too large."
            : status === 400
                ? "Invalid request body."
                : "Internal server error."
    });
});

const PORT = Number(process.env.PORT) || 3000;

const server = app.listen(PORT, "0.0.0.0", () => {
    console.log("----------------------------------");
    console.log("          VOLTAGE ONLINE");
    console.log("----------------------------------");
    console.log(`Owner: ${config.owner}`);
    console.log(`Version: ${config.version}`);
    console.log(`Port: ${PORT}`);
    console.log("AI providers: Gemini + Claude");
    console.log("Support AI: Voltage Intelligence");
    console.log("Pairing gateway: enabled");
    console.log("----------------------------------");
});

let shuttingDown = false;

async function shutdown(signal) {
    if (shuttingDown) return;

    shuttingDown = true;
    console.log(`[Voltage] ${signal} received. Shutting down.`);

    const forceExit = setTimeout(() => {
        process.exit(1);
    }, 10000);

    forceExit.unref();

    try {
        await whatsapp.stop();
    } catch (error) {
        console.error("[Voltage] WhatsApp shutdown error:", error.message);
    }

    server.close(() => {
        clearTimeout(forceExit);
        process.exit(0);
    });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
