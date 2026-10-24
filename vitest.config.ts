import { defineConfig, configDefaults } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: { exclude: [...configDefaults.exclude, "packages/**"] },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } }
});
