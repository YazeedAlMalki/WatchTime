import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const apiSpecDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(apiSpecDirectory, "..", "..");
const generatedDirectories = [
  "lib/api-client-react/src/generated",
  "lib/api-zod/src/generated",
];
const temporaryOutputRoot = await mkdtemp(
  path.join(tmpdir(), "watchtime-api-codegen-"),
);
const temporaryClientSource = path.join(
  temporaryOutputRoot,
  "lib/api-client-react/src",
);
await mkdir(temporaryClientSource, { recursive: true });
await copyFile(
  path.join(workspaceRoot, "lib/api-client-react/src/custom-fetch.ts"),
  path.join(temporaryClientSource, "custom-fetch.ts"),
);

const cleanup = async () => {
  await rm(temporaryOutputRoot, { recursive: true, force: true });
};

try {
  const generation = spawnSync(
    "pnpm",
    ["exec", "orval", "--config", "./orval.config.ts"],
    {
      cwd: apiSpecDirectory,
      env: {
        ...process.env,
        ORVAL_OUTPUT_ROOT: temporaryOutputRoot,
      },
      encoding: "utf8",
      stdio: "inherit",
    },
  );

  if (generation.error) {
    throw generation.error;
  }

  if (generation.status !== 0) {
    process.exitCode = generation.status ?? 1;
  } else {
    const temporaryZodApi = path.join(
      temporaryOutputRoot,
      "lib/api-zod/src/generated/api.ts",
    );
    const zodApi = await readFile(temporaryZodApi, "utf8");
    await writeFile(
      temporaryZodApi,
      zodApi.replaceAll("from 'zod'", "from 'zod/v4'"),
    );

    for (const generatedDirectory of generatedDirectories) {
      const expectedPath = path.join(workspaceRoot, generatedDirectory);
      const generatedPath = path.join(temporaryOutputRoot, generatedDirectory);
      const comparison = spawnSync(
        "diff",
        ["-ru", expectedPath, generatedPath],
        {
          encoding: "utf8",
        },
      );

      if (comparison.error) {
        throw comparison.error;
      }

      if (comparison.status === 1) {
        console.error(
          "API contract drift detected: generated output does not match lib/api-spec/openapi.yaml.",
        );
        console.error(
          "Run pnpm --filter @workspace/api-spec run codegen, then commit the generated client and Zod files.",
        );
        if (comparison.stdout) {
          console.error(comparison.stdout);
        }
        process.exitCode = 1;
        break;
      }

      if (comparison.status !== 0) {
        throw new Error(
          `Unable to compare generated output for ${generatedDirectory}.`,
        );
      }
    }
  }
} finally {
  await cleanup();
}
