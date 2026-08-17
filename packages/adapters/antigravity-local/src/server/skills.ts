import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AdapterSkillContext,
  AdapterSkillSnapshot,
} from "@paperclipai/adapter-utils";
import {
  buildPersistentSkillSnapshot,
  ensurePaperclipSkillSymlink,
  readPaperclipRuntimeSkillEntries,
  readInstalledSkillTargets,
  resolvePaperclipDesiredSkillNames,
} from "@paperclipai/adapter-utils/server-utils";

const __moduleDir = path.dirname(fileURLToPath(import.meta.url));

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function resolveAntigravitySkillsHomes(config: Record<string, unknown>): string[] {
  const env =
    typeof config.env === "object" && config.env !== null && !Array.isArray(config.env)
      ? (config.env as Record<string, unknown>)
      : {};
  const configuredHome = asString(env.HOME) ?? asString(env.USERPROFILE);
  const home = configuredHome ? path.resolve(configuredHome) : os.homedir();
  return [
    path.join(home, ".gemini", "skills"),
    path.join(home, ".antigravity", "skills"),
  ];
}

async function buildAntigravitySkillSnapshot(config: Record<string, unknown>): Promise<AdapterSkillSnapshot> {
  const availableEntries = await readPaperclipRuntimeSkillEntries(config, __moduleDir);
  const desiredSkills = resolvePaperclipDesiredSkillNames(config, availableEntries);
  const skillsHomes = resolveAntigravitySkillsHomes(config);
  const primarySkillsHome = skillsHomes[0];
  const installed = await readInstalledSkillTargets(primarySkillsHome);
  return buildPersistentSkillSnapshot({
    adapterType: "antigravity_local",
    availableEntries,
    desiredSkills,
    installed,
    skillsHome: primarySkillsHome,
    locationLabel: "~/.gemini/skills",
    missingDetail: "Configured but not currently linked into the Antigravity skills home.",
    externalConflictDetail: "Skill name is occupied by an external installation.",
    externalDetail: "Installed outside Paperclip management.",
  });
}

export async function listAntigravitySkills(ctx: AdapterSkillContext): Promise<AdapterSkillSnapshot> {
  return buildAntigravitySkillSnapshot(ctx.config);
}

export async function syncAntigravitySkills(
  ctx: AdapterSkillContext,
  desiredSkills: string[],
): Promise<AdapterSkillSnapshot> {
  const availableEntries = await readPaperclipRuntimeSkillEntries(ctx.config, __moduleDir);
  const desiredSet = new Set(desiredSkills);
  const skillsHomes = resolveAntigravitySkillsHomes(ctx.config);
  const availableByRuntimeName = new Map(availableEntries.map((entry) => [entry.runtimeName, entry]));

  for (const skillsHome of skillsHomes) {
    await fs.mkdir(skillsHome, { recursive: true });
    const installed = await readInstalledSkillTargets(skillsHome);

    for (const available of availableEntries) {
      if (!desiredSet.has(available.key)) continue;
      const target = path.join(skillsHome, available.runtimeName);
      await ensurePaperclipSkillSymlink(available.source, target);
    }

    for (const [name, installedEntry] of installed.entries()) {
      const available = availableByRuntimeName.get(name);
      if (!available) continue;
      if (desiredSet.has(available.key)) continue;
      if (installedEntry.targetPath !== available.source) continue;
      await fs.unlink(path.join(skillsHome, name)).catch(() => {});
    }
  }

  return buildAntigravitySkillSnapshot(ctx.config);
}

export function resolveAntigravityDesiredSkillNames(
  config: Record<string, unknown>,
  availableEntries: Array<{ key: string }>,
) {
  return resolvePaperclipDesiredSkillNames(config, availableEntries);
}
