import { defineConfig } from "tsup";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { dirname } from "node:path";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    react: "src/react/index.ts",
    vue: "src/vue/index.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  minify: false,
  target: "es2022",
  outDir: "dist",
  external: ["react", "react-dom", "vue"],
  // Copy non-TS assets (CSS) into dist alongside the compiled output. tsup
  // doesn't bundle CSS; these are shipped as standalone files for users who
  // want the default styles (`import "agent-action-shield/react/modal.css"`).
  onSuccess: async () => {
    for (const fw of ["react", "vue"] as const) {
      const src = `src/${fw}/modal.css`;
      const dest = `dist/${fw}/modal.css`;
      if (existsSync(src)) {
        mkdirSync(dirname(dest), { recursive: true });
        copyFileSync(src, dest);
      }
    }
  },
});
