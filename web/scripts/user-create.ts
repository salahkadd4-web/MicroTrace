import { config } from "dotenv";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";

config({ path: [".env.local", ".env"], quiet: true });

/** Lit n lignes sur l'entrée standard (hors terminal : tests, CI). */
async function readLines(n: number): Promise<string[]> {
  const rl = createInterface({ input: process.stdin });
  const lines: string[] = [];
  for await (const line of rl) {
    lines.push(line);
    if (lines.length === n) break;
  }
  rl.close();
  return lines;
}

/** Lit un mot de passe au terminal, sans écho. */
function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n" || ch === "\u0004") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (ch === "\u0003") {
          stdin.setRawMode(false);
          process.exit(130);
        }
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

async function main() {
  const { values } = parseArgs({
    options: {
      email: { type: "string" },
      name: { type: "string" },
      "platform-admin": { type: "boolean", default: false },
    },
  });
  if (!values.email || !values.name) {
    console.error("Usage : npm run user:create -- --email <adresse> --name <nom>");
    process.exit(2);
  }
  let password: string;
  if (process.stdin.isTTY) {
    password = await askHidden("Mot de passe : ");
    const confirm = await askHidden("Confirmez le mot de passe : ");
    if (password !== confirm) {
      console.error("Les deux mots de passe ne correspondent pas.");
      process.exit(1);
    }
  } else {
    const [a, b] = await readLines(2);
    if (a === undefined || b === undefined || a !== b) {
      console.error("Les deux mots de passe ne correspondent pas.");
      process.exit(1);
    }
    password = a;
  }
  const { createUser } = await import("../src/server/users");
  const { prisma } = await import("../src/server/db");
  try {
    const user = await createUser({
      email: values.email,
      name: values.name,
      password,
      isPlatformAdmin: values["platform-admin"],
    });
    console.log(`Utilisateur créé : ${user.email}`);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
