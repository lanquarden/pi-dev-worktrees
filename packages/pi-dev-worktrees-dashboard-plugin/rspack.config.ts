/**
 * Rspack production build for the pi-dev-worktrees dashboard plugin.
 *
 * Builds a Module Federation remote entry that the dashboard host loads at
 * runtime via dynamic import(). The host shares react, react-dom, and
 * dashboard-plugin-runtime as singletons to prevent dual-instance bugs.
 *
 * See change: runtime-plugin-loading (Decision 1, Decision 2).
 */
import { defineConfig } from "@rspack/cli";
import rspack from "@rspack/core";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  entry: {
    main: "./src/index.tsx",
  },

  output: {
    path: path.resolve(__dirname, "dist"),
    publicPath: "auto",
    filename: "main.js",
    chunkFilename: "assets/[name].[contenthash:8].js",
    cssFilename: "assets/[name].[contenthash:8].css",
    clean: true,
  },

  resolve: {
    extensions: [".tsx", ".ts", ".jsx", ".js", ".mjs"],
    extensionAlias: {
      ".js": [".ts", ".tsx", ".js", ".jsx"],
      ".jsx": [".tsx", ".ts", ".jsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    },
  },

  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: {
          loader: "builtin:swc-loader",
          options: {
            jsc: {
              parser: { syntax: "typescript", tsx: true },
              transform: { react: { runtime: "automatic" } },
            },
          },
        },
        type: "javascript/auto",
      },
      {
        test: /\.css$/,
        use: ["postcss-loader"],
        type: "css",
      },
    ],
  },

  plugins: [
    new rspack.container.ModuleFederationPlugin({
      name: "piDevWorktreesDashboard",
      filename: "remoteEntry.js",
      exposes: {
        ".": "./src/index.tsx",
      },
      shared: {
        react: {
          singleton: true,
          requiredVersion: "^19.0.0",
          eager: false,
        },
        "react-dom": {
          singleton: true,
          requiredVersion: "^19.0.0",
          eager: false,
        },
        "@blackbelt-technology/dashboard-plugin-runtime": {
          singleton: true,
          eager: false,
          requiredVersion: false,
        },
      },
    }),
  ],

  experiments: {
    css: true,
  },

  stats: "errors-warnings",
  devtool: "source-map",
});
