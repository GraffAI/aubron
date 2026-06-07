/**
 * Auth + config commands: login, logout, config show.
 */
import { AnkerClient, ConfigStore, redactConfig, UsageError } from "@aubron/ankerts";
import { defineCommand, type CommandSpec } from "../spec.js";
import { flagBool, flagStr, str } from "../runtime.js";

const login: CommandSpec = defineCommand({
  path: ["login"],
  summary: "Authenticate to an AnkerMake/eufyMake account and store credentials.",
  description:
    "Logs in over the cloud HTTPS API (email/password → token; the password is " +
    "ECDH-encrypted in transit), then fetches the account's printer list and keys. " +
    "If the API returns a captcha challenge, you get a structured, actionable error " +
    "(captcha_id + image URL) — never a hang. Re-run with --captcha-answer to solve it.",
  transport: "https",
  flags: [
    { name: "email", type: "string", description: "Account email." },
    {
      name: "password",
      type: "string",
      description: "Account password. Use `-` to read from stdin, or set ANKER_PASSWORD.",
    },
    { name: "country", type: "string", description: "2-letter country code selecting the region." },
    { name: "save", type: "boolean", description: "Persist credentials to the config store." },
    { name: "captcha-id", type: "string", description: "Captcha id from a prior captcha error." },
    { name: "captcha-answer", type: "string", description: "Captcha answer text." },
  ],
  exitCodes: [0, 2, 3, 5],
  examples: [
    {
      description: "Log in and store credentials",
      cmd: "ankerts login --email me@example.com --password hunter2 --country US --save",
      output: '{ "account": { "email": "me@example.com", "region": "us" }, "printers": 1 }',
    },
    {
      description: "Read the password from stdin (keeps it out of argv/history)",
      cmd: "echo $PW | ankerts login --email me@example.com --password - --country US --save",
    },
  ],
  async run(ctx) {
    const email = str(ctx.args.values.email);
    const country = str(ctx.args.values.country);
    let password = flagStr(ctx.args, "password") ?? process.env.ANKER_PASSWORD ?? "";
    if (password === "-") password = (await ctx.readStdin()).trim();

    if (!email || !country) {
      throw new UsageError({
        message: "--email and --country are required",
        input: { email: email || null, country: country || null },
      });
    }
    if (!password) {
      throw new UsageError({
        message: "no password provided",
        hint: "Pass --password <pw>, set ANKER_PASSWORD, or use --password - to read stdin.",
      });
    }
    if (ctx.globals.dryRun) {
      ctx.out.emit({ dryRun: true, action: "login", email, country });
      return;
    }

    const client = await AnkerClient.login({
      email,
      password,
      country,
      captchaId: flagStr(ctx.args, "captcha-id"),
      captchaAnswer: flagStr(ctx.args, "captcha-answer"),
      save: flagBool(ctx.args, "save"),
    });
    const cfg = client.getConfig();
    if (!flagBool(ctx.args, "save")) {
      ctx.out.log("note: credentials were NOT saved (pass --save to persist).");
    } else {
      ctx.out.log("login ok — credentials stored.");
    }
    ctx.out.emit({ account: redactConfig(cfg).account, printers: cfg.printers.length });
  },
});

const logout: CommandSpec = defineCommand({
  path: ["logout"],
  summary: "Remove stored credentials and printer config.",
  description: "Clears the account token from the local config store. Printers are forgotten.",
  transport: "none",
  exitCodes: [0, 1],
  examples: [{ cmd: "ankerts logout" }],
  run(ctx) {
    const store = new ConfigStore();
    if (ctx.globals.dryRun) {
      ctx.out.emit({ dryRun: true, action: "logout", path: store.path });
      return;
    }
    store.save({ account: null, printers: [] });
    ctx.out.emit({ ok: true, message: "logged out" });
  },
});

const configShow: CommandSpec = defineCommand({
  path: ["config", "show"],
  summary: "Show the current stored config (secrets redacted by default).",
  description:
    "Prints the account and per-printer records from the local config store. Secrets " +
    "(auth token, MQTT/PPPP keys) are redacted unless you pass --reveal.",
  transport: "none",
  flags: [{ name: "reveal", type: "boolean", description: "Show secret values in clear text." }],
  exitCodes: [0, 1],
  examples: [
    { description: "Inspect config safely", cmd: "ankerts config show" },
    {
      description: "Get the first printer's DUID",
      cmd: "ankerts config show --json | jq -r '.printers[0].duid'",
    },
  ],
  run(ctx) {
    const store = new ConfigStore();
    ctx.out.emit(redactConfig(store.load(), flagBool(ctx.args, "reveal")));
  },
});

export const authCommands = [login, logout, configShow];
