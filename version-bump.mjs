/* Keeps the three version records in sync: package.json (the source of truth,
   already written by `npm version` before this runs), manifest.json, and
   versions.json.

   Obsidian reads manifest.json for the installed version and versions.json to
   decide which release an older app can still install — the map is
   plugin version -> the minimum Obsidian version that release needs.

   Usage:
     npm version patch|minor|major   (runs this via the `version` script)
     node version-bump.mjs 0.2.0     (manual, when not going through npm) */

import { readFileSync, writeFileSync } from "node:fs";

const targetVersion = process.argv[2] || process.env.npm_package_version;

if (!targetVersion) {
	console.error(
		"No target version. Run `npm version <patch|minor|major>`, or pass one: `node version-bump.mjs 0.2.0`.",
	);
	process.exit(1);
}

/* The release workflow requires tag === manifest version, and the community
   submission checker rejects a `v` prefix, so reject anything that isn't a
   bare semver here rather than at tag time. */
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(targetVersion)) {
	console.error(`Not a bare semver version (no "v" prefix allowed): ${targetVersion}`);
	process.exit(1);
}

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const { minAppVersion } = manifest;

if (!minAppVersion) {
	console.error("manifest.json has no minAppVersion.");
	process.exit(1);
}

/* 2-space indent + trailing newline matches the files as committed, so a bump
   diffs as one changed line rather than a whole-file reformat. */
manifest.version = targetVersion;
writeFileSync("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);

const versions = JSON.parse(readFileSync("versions.json", "utf8"));
versions[targetVersion] = minAppVersion;
writeFileSync("versions.json", `${JSON.stringify(versions, null, 2)}\n`);

console.log(`Bumped to ${targetVersion} (minAppVersion ${minAppVersion}).`);
