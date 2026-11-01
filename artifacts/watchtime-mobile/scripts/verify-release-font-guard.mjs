import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = mkdtempSync(path.join(tmpdir(), 'watchtime-release-font-guard-'));
const platforms = ['ios', 'android'];
const expectedInterFonts = [
  'Inter_400Regular',
  'Inter_500Medium',
  'Inter_600SemiBold',
  'Inter_700Bold',
];

function assertReleaseFontGate(bundlePath, platform) {
  const bundle = readFileSync(bundlePath, 'utf8');
  const fontRegistrationPattern = new RegExp(
    expectedInterFonts
      .map((font, index) => `${font}:${index === 0 ? '([\\w$]+)' : '\\1'}\\.${font}`)
      .join(','),
  );
  const fontRegistration = fontRegistrationPattern.exec(bundle);

  if (!fontRegistration) {
    throw new Error(`${platform} release bundle does not register all four Inter weights`);
  }

  for (const font of expectedInterFonts) {
    if (!bundle.includes(`name:"${font}",type:"ttf"`)) {
      throw new Error(`${platform} release bundle does not include the ${font} font asset`);
    }
  }

  const fontModule = fontRegistration[1];
  const hookCallPattern = new RegExp(`${fontModule}\\.useFonts\\)\\([\\w$]+\\)`);
  const hookCall = bundle.slice(fontRegistration.index).search(hookCallPattern);
  if (hookCall < 0 || hookCall > 250) {
    throw new Error(`${platform} release bundle does not call the Inter useFonts hook`);
  }

  const fontLoader = bundle.slice(fontRegistration.index, fontRegistration.index + 1_200);
  if (!/[\w$]+\|\|[\w$]+\?[\s\S]{0,600}:null/.test(fontLoader)) {
    throw new Error(`${platform} release bundle no longer waits for Inter before rendering`);
  }

  if (
    bundle.includes('EXPO_PUBLIC_SKIP_INTER_LOADING') ||
    bundle.includes('Development-only forced Inter font loading failure')
  ) {
    throw new Error(`${platform} release bundle contains the development-only font bypass`);
  }
}

try {
  const exportResult = spawnSync(
    'pnpm',
    [
      'exec',
      'expo',
      'export',
      '--platform',
      'all',
      // Keep the optimized JavaScript readable enough to inspect instead of emitting Hermes bytecode.
      '--no-bytecode',
      '--output-dir',
      outputDir,
    ],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        CI: '1',
        EXPO_NO_TELEMETRY: '1',
        EXPO_PUBLIC_SKIP_INTER_LOADING: '1',
        NODE_ENV: 'production',
      },
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
    },
  );

  if (exportResult.error) throw exportResult.error;
  if (exportResult.status !== 0) {
    process.stdout.write(exportResult.stdout ?? '');
    process.stderr.write(exportResult.stderr ?? '');
    throw new Error(`Expo production export failed with exit code ${exportResult.status}`);
  }

  const metadataPath = path.join(outputDir, 'metadata.json');
  const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));

  for (const platform of platforms) {
    const bundleRelativePath = metadata.fileMetadata?.[platform]?.bundle;
    if (!bundleRelativePath) {
      throw new Error(`Expo export did not produce a ${platform} release bundle`);
    }

    assertReleaseFontGate(path.join(outputDir, bundleRelativePath), platform);
    console.log(`${platform}: release bundle keeps Inter font loading enabled`);
  }
} finally {
  rmSync(outputDir, { recursive: true, force: true });
}
