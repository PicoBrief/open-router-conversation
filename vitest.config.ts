import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";

export default defineConfig(({ mode }) => ({
    test: {
        environment: "node",
        testTimeout: 30_000,
        // Load all variables from .env / .env.local / .env.{mode} into process.env.
        // The empty-string prefix means no VITE_ filtering — all keys are included.
        env: loadEnv(mode, process.cwd(), ""),
    },
}));
