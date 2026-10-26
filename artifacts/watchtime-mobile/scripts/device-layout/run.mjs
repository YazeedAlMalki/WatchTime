import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assessScreen, classifyDevice, requiredProbes, validateConfig } from './evidence.mjs';

const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const elementKey = 'element-6066-11e4-a52e-4f735466cecf';

// No upload, cloud connection, app installation, build or sign-in is performed.
// The operator prepares Expo Go/WatchTime and the native Appium driver first.
export async function run(config, {
  diagnostic = false,
  outputRoot = resolve(root, 'generated-artifacts/mobile-layout'),
} = {}) {
  const platform = validateConfig(config);
  let session;
  let classification = 'unverified-native';
  const report = {
    schemaVersion: 1, startedAt: new Date().toISOString(),
    platform, purpose: 'ongoing-layout-regression', nativeAcceptance: 'not-performed',
    status: 'blocked', statusMeaning: 'automated-measurement-checks-only',
    physicalEvidence: false, screens: [], visualReview: 'required',
    limitations: [
      'Line bounds detect text-box overflow, not every glyph, ancestor clip or overlap.',
      'Poster names intentionally truncate at two lines and are not overflow assertions.',
      'Screenshots need visual review; automatic pass is not native acceptance.',
    ],
  };
  const images = new Map();
  async function request(path, method = 'GET', body) {
    const response = await fetch(`${config.serverUrl.replace(/\/$/, '')}${path}`, {
      method, headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(45_000),
    });
    const json = await response.json();
    if (!response.ok || json.value?.error) {
      // Do not persist driver error messages: they can contain URLs/account data.
      throw new Error(`Appium command failed (${method} ${path.replace(session ?? 'no-session', 'SESSION')}; ${response.status})`);
    }
    return json.value;
  }
  const command = (path, method, body) => request(`/session/${session}${path}`, method, body);
  const execute = (script, args = {}) => command('/execute/sync', 'POST', { script, args: [args] });
  const find = async (id) => {
    const using = platform === 'ios' ? 'accessibility id' : 'id';
    const result = await command('/element', 'POST', { using, value: id });
    return result[elementKey] ?? result.ELEMENT;
  };
  const getMetadata = async (screen) => {
    const id = await find(`layout-evidence-${screen}`);
    const attribute = platform === 'ios' ? 'label' : 'content-desc';
    return JSON.parse(await command(`/element/${id}/attribute/${attribute}`));
  };
  const screenshot = async (name) => {
    const base64 = await command('/screenshot');
    const png = Buffer.from(base64, 'base64');
    if (png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
      throw new Error('Appium did not return a PNG screenshot');
    }
    images.set(`${name}.png`, png);
  };
  try {
    const created = await request('/session', 'POST', {
      capabilities: { alwaysMatch: config.capabilities, firstMatch: [{}] },
    });
    session = created.sessionId;
    if (!session) throw new Error('Appium returned no session');
    const info = await execute('mobile: deviceInfo');
    let usbPhysical = false;
    if (platform === 'android') {
      const udid = created.capabilities?.['appium:udid'] ?? created.capabilities?.udid ??
        config.capabilities['appium:udid'];
      if (udid) {
        try {
          const devices = (await exec('adb', ['devices', '-l'], { timeout: 10_000 })).stdout;
          const row = devices.split('\n').find((line) => line.split(/\s+/)[0] === udid);
          const qemu = (await exec('adb', ['-s', udid, 'shell', 'getprop', 'ro.kernel.qemu'],
            { timeout: 10_000 })).stdout.trim();
          usbPhysical = Boolean(row && /\sdevice\s/.test(row) && /\busb:\S+/.test(row) &&
            !udid.startsWith('emulator-') && qemu !== '1');
        } catch { /* Explicitly unverified; never upgrade a missing proof to physical. */ }
      }
    }
    classification = classifyDevice(platform, info, usbPhysical, created.capabilities?.browserName);
    report.device = {
      model: info.ProductType ?? info.model ?? null,
      osVersion: info.ProductVersion ?? info.platformVersion ??
        created.capabilities?.platformVersion ?? created.capabilities?.['appium:platformVersion'] ?? null,
      classification,
      proof: platform === 'ios' ? { isSimulator: info.isSimulator ?? null } : { usbPhysical },
    };
    for (const screen of ['browse', 'title']) {
      const result = { screen, status: 'blocked', observations: [], screenshots: [] };
      report.screens.push(result);
      try {
        await execute('mobile: deepLink', {
          url: config[`${screen}Url`],
          ...(platform === 'ios' ? { bundleId: config.appId } : { package: config.appId }),
        });
        let metadata;
        let previous = '';
        const deadline = Date.now() + 35_000;
        while (Date.now() < deadline) {
          try {
            const current = await getMetadata(screen);
            const serialized = JSON.stringify(current);
            const complete = current.contentReady === true &&
              (screen !== 'title' || current.titleId === config.expected.titleId) &&
              requiredProbes[screen].every((id) => current.measurements?.[id]?.lines?.length);
            if (complete && serialized === previous) { metadata = current; break; }
            previous = serialized;
          } catch { /* Startup/navigation/metadata readiness is bounded by deadline. */ }
          await sleep(600);
        }
        if (!metadata) throw new Error('No stable native measurements; enable instrumentation and select a movie title with both actions');
        result.metadata = metadata;
        result.observations = assessScreen(screen, metadata, config.expected, platform);
        result.status = result.observations.every((o) => o.status === 'pass') ? 'pass' : 'fail';
        if (screen === 'title') {
          await screenshot('title-top');
          result.screenshots.push('title-top.png');
          // Bring the action row into view without pressing a mutating action.
          if (platform === 'ios') {
            await execute('mobile: scroll', { elementId: await find('title-primary-actions'), toVisible: true });
          } else {
            await command('/element', 'POST', {
              using: '-android uiautomator',
              value: 'new UiScrollable(new UiSelector().scrollable(true)).scrollIntoView(new UiSelector().resourceId("title-primary-actions"))',
            });
          }
        }
      } catch (error) {
        result.status = 'blocked';
        result.observations.push({ name: 'capture', status: 'fail', detail: error.message });
      }
      try {
        await screenshot(screen);
        result.screenshots.push(`${screen}.png`);
      } catch {
        result.status = 'blocked';
        result.observations.push({ name: 'screenshot', status: 'fail', detail: 'Screenshot unavailable' });
      }
    }
    const complete = report.screens.every((s) => s.status === 'pass');
    const identified = Boolean(report.device.model && report.device.osVersion);
    report.status = complete && identified && (classification === 'physical' || diagnostic) ? 'pass' : 'fail';
    report.physicalEvidence = identified && classification === 'physical' &&
      report.screens.every((s) => s.metadata && s.screenshots.length > 0);
  } catch (error) {
    report.error = error.message;
  } finally {
    if (session) {
      try { await command('', 'DELETE'); }
      catch { report.cleanup = 'Session cleanup failed; stop it on the local Appium server'; }
    }
  }
  report.finishedAt = new Date().toISOString();
  // Classification is driver-derived, never supplied by the operator.
  const output = resolve(outputRoot, classification, platform,
    report.startedAt.replace(/[:.]/g, '-'));
  await mkdir(output, { recursive: true });
  for (const [name, png] of images) await writeFile(resolve(output, name), png);
  await writeFile(resolve(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Layout evidence: ${report.status}; ${classification}; ${output}`);
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args[0] !== '--run' || !args[1]) {
    console.log('Opt-in only: pnpm test:device-layout --run /path/to/local-config.json [--diagnostic]');
    console.log('See docs/watchtime-mobile-layout-testing.md. No devices or providers were contacted.');
  } else {
    try {
      const report = await run(JSON.parse(await readFile(args[1], 'utf8')), { diagnostic: args.includes('--diagnostic') });
      process.exitCode = report.status === 'pass' ? 0 : 1;
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
