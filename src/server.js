
require("dotenv").config();

const crypto = require("crypto");
const path = require("path");
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

    const a = Buffer.from(expected);
    const b = Buffer.from(provided);

    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "../public/index.html"));
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
    res.set("Cache-Control", "no-store");
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
            error: "Invalid gateway access key."
        });
    }

    const number = req.body?.number;

    if (typeof number !== "string" || !number.trim()) {
        return res.status(400).json({
            status: false,
            error: "Provide your WhatsApp number."
        });
    }

    try {
        const status = await whatsapp.connect(number);

        res.set("Cache-Control", "no-store");

        return res.json({
            status: true,
            whatsapp: status,
            instructions: status.pairingCode
                ? "Enter the code in WhatsApp > Linked devices > Link with phone number."
                : "Check the status endpoint for the current connection state."
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
    console.log("Pairing dashboard: enabled");
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
