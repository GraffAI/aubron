import { describe, expect, it } from "vitest";
import { asString, parseFrontmatter } from "./frontmatter.js";
import { buildMarketplace, type SkillPackageInfo } from "./marketplace.js";
import { validatePluginJson, validateSkillMd } from "./validate.js";

describe("parseFrontmatter", () => {
  it("parses scalars, quoted values, and lists", () => {
    const { data, body } = parseFrontmatter(
      [
        "---",
        "name: my-skill",
        'description: "Does a thing"',
        "allowed-tools:",
        "  - Bash",
        "  - Read",
        "---",
        "",
        "Body text.",
      ].join("\n"),
    );
    expect(data.name).toBe("my-skill");
    expect(data.description).toBe("Does a thing");
    expect(data["allowed-tools"]).toEqual(["Bash", "Read"]);
    expect(body.trim()).toBe("Body text.");
    expect(asString(data["allowed-tools"])).toBe("Bash");
  });

  it("returns empty data when there is no frontmatter", () => {
    expect(parseFrontmatter("# just markdown").data).toEqual({});
  });
});

describe("validateSkillMd", () => {
  it("accepts a well-formed skill", () => {
    const r = validateSkillMd(
      [
        "---",
        "name: ankerts",
        "description: Drive AnkerMake M5 printers from an agent.",
        "---",
        "",
        "Use the CLI.",
      ].join("\n"),
    );
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("rejects a missing description and a non-kebab name", () => {
    const r = validateSkillMd(["---", "name: My_Skill", "---", "", "body"].join("\n"));
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /kebab-case/.test(e))).toBe(true);
    expect(r.errors.some((e) => /description/.test(e))).toBe(true);
  });

  it("errors when frontmatter is absent", () => {
    expect(validateSkillMd("no frontmatter here").ok).toBe(false);
  });
});

describe("validatePluginJson", () => {
  it("requires a kebab-case name", () => {
    expect(validatePluginJson({ name: "skill-factory" }).ok).toBe(true);
    expect(validatePluginJson({ name: "Bad Name" }).ok).toBe(false);
    expect(validatePluginJson(null).ok).toBe(false);
  });
});

describe("buildMarketplace — hybrid sources", () => {
  const infos: SkillPackageInfo[] = [
    {
      dirName: "skill-factory",
      pluginName: "skill-factory",
      npmName: "@aubron/skill-factory",
      version: "0.1.0",
      description: "Create and release skills.",
      preferredSource: "git-subdir",
    },
    {
      dirName: "ankerts-skill",
      pluginName: "ankerts",
      npmName: "@aubron/ankerts-skill",
      version: "1.2.0",
      preferredSource: "npm",
    },
  ];

  it("emits git-subdir and npm sources per the package preference", () => {
    const mp = buildMarketplace(infos, { repoUrl: "https://github.com/GraffAI/aubron.git" }) as {
      name: string;
      plugins: { name: string; source: Record<string, string> }[];
    };
    expect(mp.name).toBe("aubron");
    const factory = mp.plugins.find((p) => p.name === "skill-factory")!;
    expect(factory.source).toEqual({
      source: "git-subdir",
      url: "https://github.com/GraffAI/aubron.git",
      path: "packages/skill-factory",
    });
    const ankerts = mp.plugins.find((p) => p.name === "ankerts")!;
    expect(ankerts.source).toEqual({
      source: "npm",
      package: "@aubron/ankerts-skill",
      version: "^1.2.0",
    });
  });
});
