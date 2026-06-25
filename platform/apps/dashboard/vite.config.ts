import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:4010",
        ws: true
      },
      "/artifacts": "http://localhost:4010"
    }
  }
});
