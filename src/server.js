
require("dotenv").config();

const express = require("express");
const { router: aiRouter } = require("./ai");

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

app.get("/", (req, res) => {
    res.json({
        name: config.name,
        description: "Personal dual-brain AI system",
        status: "online",
        owner: config.owner,
        version: config.version,
        platform: "WhatsApp",
        runtime: "Node.js",
        stage: 1
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
        aiProviders: ["gemini", "claude"]
    });
});

app.use("/api/ai", aiRouter);

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
    console.log("----------------------------------");
});

function shutdown(signal) {
    console.log(`[Voltage] ${signal} received. Shutting down.`);

    server.close(() => {
        process.exit(0);
    });

    setTimeout(() => process.exit(1), 10000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
