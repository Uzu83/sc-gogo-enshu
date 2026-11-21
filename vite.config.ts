import { defineConfig, type Plugin } from "vitest/config";
import { gradeDevMiddleware } from "./src/grade-dev";

function gradeDevPlugin(): Plugin {
  const handle = gradeDevMiddleware();
  return {
    name: "sc-grade-dev",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        void handle(req, res, next);
      });
    },
  };
}

export default defineConfig({
  plugins: [gradeDevPlugin()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
