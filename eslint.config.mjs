import { defineConfig, globalIgnores } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
	globalIgnores(["main.js", "node_modules", "coverage"]),
	...obsidianmd.configs.recommended,
	{
		languageOptions: {
			parserOptions: {
				projectService: {
					allowDefaultProject: ["*.mjs", "*.mts"],
				},
			},
		},
		plugins: { "@typescript-eslint": tseslint.plugin },
		rules: {
			"@typescript-eslint/no-unused-vars": [
				"error",
				{ argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
			],
		},
	},
	{
		// Build tooling and tests run in Node, never inside Obsidian.
		files: ["*.mjs", "*.mts", "**/*.test.ts"],
		languageOptions: { globals: globals.node },
		rules: {
			"obsidianmd/no-nodejs-modules": "off",
			"obsidianmd/rule-custom-message": "off",
		},
	},
]);
