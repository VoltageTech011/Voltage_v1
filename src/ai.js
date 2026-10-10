
const express = require("express");

const router = express.Router();

const PROVIDERS = {
    gemini: {
        url: "https://api-abztech.zone.id/ai/gemini",
        parameter: "message"
    },
    claude: {
        url: "https://api-abztech.zone.id/ai/claude",
        parameter: "q"
    }
};

const MAX_PROMPT_LENGTH = 2000;
const TIMEOUT_MS = Math.max(
    1000,
    Math.min(Number(process.env.AI_TIMEOUT_MS) || 30000, 60000)
);

function extractAnswer(data) {
    if (typeof data === "string") {
        return data.trim();
    }

    if (!data || typeof data !== "object") {
        return "";
    }

    const keys = [
        "answer",
        "response",
        "output",
        "content",
        "text",
        "result",
        "message"
    ];

    for (const key of keys) {
        const value = data[key];

        if (typeof value === "string" && value.trim()) {
            return value.trim();
        }

        if (value && typeof value === "object") {
            const nested = extractAnswer(value);
            if (nested) return nested;
        }
    }

    return "";
}

async function askProvider(providerName, prompt) {
    const provider = PROVIDERS[providerName];

    if (!provider) {
        throw new Error("Unsupported AI provider.");
    }

    const url = new URL(provider.url);
    url.searchParams.set(provider.parameter, prompt);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
        const response = await fetch(url, {
            method: "GET",
            headers: {
                Accept: "application/json, text/plain"
            },
            signal: controller.signal
        });

        const body = await response.text();

        let data;

        try {
            data = JSON.parse(body);
        } catch {
            data = body;
        }

        if (!response.ok) {
            const error = new Error(
                `AI provider returned HTTP ${response.status}.`
            );
            error.status = 502;
            throw error;
        }

        if (
            data &&
            typeof data === "object" &&
            data.status === false
        ) {
            const error = new Error(
                typeof data.message === "string"
                    ? data.message
                    : "The AI provider reported a failure."
            );
            error.status = 502;
            throw error;
        }

        const answer = extractAnswer(data);

        if (!answer) {
            const error = new Error(
                "The provider responded, but its answer format was not recognized."
            );
            error.status = 502;
            throw error;
        }

        return {
            provider: providerName,
            answer
        };
    } catch (error) {
        if (error.name === "AbortError") {
            const timeoutError = new Error("The AI request timed out.");
            timeoutError.status = 504;
            throw timeoutError;
        }

        if (error.status) throw error;

        const networkError = new Error(
            "Could not reach the AI provider."
        );
        networkError.status = 502;
        throw networkError;
    } finally {
        clearTimeout(timeout);
    }
}

router.get("/:provider", async (req, res) => {
    const providerName = String(req.params.provider).toLowerCase();
    const provider = PROVIDERS[providerName];

    if (!provider) {
        return res.status(404).json({
            status: false,
            error: "Unknown AI provider.",
            available: Object.keys(PROVIDERS)
        });
    }

    const parameter = provider.parameter;
    const prompt = req.query[parameter];

    if (typeof prompt !== "string" || !prompt.trim()) {
        return res.status(400).json({
            status: false,
            error: `Missing query parameter: ${parameter}`,
            example: `/api/ai/${providerName}?${parameter}=hi`
        });
    }

    if (prompt.length > MAX_PROMPT_LENGTH) {
        return res.status(413).json({
            status: false,
            error: `Prompt must not exceed ${MAX_PROMPT_LENGTH} characters.`
        });
    }

    try {
        const result = await askProvider(
            providerName,
            prompt.trim()
        );

        return res.json({
            status: true,
            provider: result.provider,
            answer: result.answer
        });
    } catch (error) {
        console.error(
            `[Voltage AI] ${providerName}:`,
            error.message
        );

        return res.status(error.status || 502).json({
            status: false,
            provider: providerName,
            error: error.message || "AI request failed."
        });
    }
});

module.exports = {
    router,
    askProvider
};
