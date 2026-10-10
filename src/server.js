
require("dotenv").config();

const crypto = require("crypto");
const express = require("express");
const { router: aiRouter } = require("./ai");
const whatsapp = require("./whatsapp");

const app = express();

app.disable("x-powered-by");
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

    if (!expected || !provided) return false;

    const expectedBuffer = Buffer.from(expected);
    const providedBuffer = Buffer.from(provided);

    if (expectedBuffer.length !== providedBuffer.length) {
        return false;
    }

    return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

app.get("/", (req, res) => {
    res.json({
        name: config.name,
        description: "Personal multi-capability AI system",
        status: "online",
        owner: config.owner,
        version: config.version,
        platform: "WhatsApp",
        runtime: "Node.js",
        whatsapp: whatsapp.getStatus().status
    });
});

app.get("/api/health", (req, res) => {
    res.json({
        status: "ok",
        service: config.name,
        uptime: Math.floor(process.uptime()),
        timestamp: new Date().toISOString()
    });
});

app.get("/api/info", (req, res) => {
    res.json({
        name: config.name,
        owner: config.owner,
        prefix: config.prefix,
        mode: config.mode,
        version: config.version,
        aiProviders: ["gemini", "claude"],
        whatsapp: whatsapp.getStatus().status
    });
});

app.use("/api/ai", aiRouter);

app.get("/api/whatsapp/status", (req, res) => {
    res.json({
        status: true,
        whatsapp: whatsapp.getStatus()
    });
});

app.post("/api/whatsapp/pair", async (req, res) => {
    if (!process.env.VOLTAGE_PAIRING_SECRET) {
        return res.status(503).json({
            status: false,
            error: "Pairing is disabled. Configure VOLTAGE_PAIRING_SECRET in Render."
        });
    }

    if (!isAuthorized(req)) {
        return res.status(401).json({
            status: false,
            error: "Unauthorized."
        });
    }

    const number = req.body?.number;

    if (typeof number !== "string" || !number.trim()) {
        return res.status(400).json({
            status: false,
            error: "Provide number in the JSON request body."
        });
    }

    try {
        const status = await whatsapp.connect(number);

        return res.json({
            status: true,
            whatsapp: status,
            instructions: status.pairingCode
                ? "Open WhatsApp > Linked devices > Link a device > Link with phone number, then enter the pairing code."
                : "Check the WhatsApp status endpoint for the latest connection state."
        });
    } catch (error) {
        console.error("[Voltage] Pairing request failed:", error.message);

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

    if (res.headersSent) return next(error);

    res.status(error.status || 500).json({
        status: false,
        error: "Internal server error."
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
    console.log("WhatsApp engine: Ready for pairing");
    console.log("----------------------------------");
});

let shuttingDown = false;

async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log(`[Voltage] ${signal} received. Shutting down.`);

    try {
        await whatsapp.stop();
    } catch (error) {
        console.error("[Voltage] WhatsApp shutdown error:", error.message);
    }

    server.close(() => process.exit(0));

    setTimeout(() => process.exit(1), 10000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
