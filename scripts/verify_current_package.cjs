'use strict';
// Read-only verification of the current release; never opens the live database.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const assert = require('node:assert/strict');
const asar = require('@electron/asar');
const root = path.resolve(__dirname, '..');
const config = require('../package.json');
const release = path.join(root, config.build.directories.output);
const resources = path.join(release, 'win-unpacked/resources');
const archive = path.join(resources, 'app.asar');
const normalize = value => value.replace(/\\/g, '/').replace(/^\/+/, '');
const native = value => value.split('/').join(path.sep);
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const files = asar.listPackage(archive).map(normalize).filter(file => !asar.statFile(archive, native(file)).files);
const extract = file => asar.extractFile(archive, native(file));
assert(!files.some(file => /(?:^|\/)\.env(?:\.|$)|\.(?:db|sqlite|jks|keystore)$|credentials\.json$/.test(file)), 'Private runtime data entered the archive');
const checked = [];
for (const file of files.filter(file => /^(?:src|public)\//.test(file))) {
  const current = path.join(root, native(file));
  assert(fs.existsSync(current), `Stale packaged file: ${file}`);
  const bytes = extract(file);
  assert.equal(hash(bytes), hash(fs.readFileSync(current)), `Source differs from package: ${file}`);
  checked.push(file);
}
assert(checked.includes('src/system-notifications.js'));
assert(!extract('public/nodes.html').toString().includes('Monitoring readings'));
assert(extract('public/js/ac-command-schedules.js').toString().includes('IR transmitter unavailable'));
assert(extract('src/main.js').toString().includes("setAppUserModelId('com.ecotrack.app')"));
const walk = folder => fs.readdirSync(folder, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(path.join(folder, entry.name)) : [path.join(folder, entry.name)]);
const resourceFiles = walk(resources);
assert(!resourceFiles.some(file => /(?:^|[\\/])\.env(?:\.|$)|\.(?:db|sqlite|key|keystore|jks)$/.test(file)), 'Private data entered packaged resources');
const values = require('dotenv').parse(fs.readFileSync(path.join(root, '.env')));
const privateValues = Object.entries(values).filter(([key, value]) => value.length >= 12 && /SERVICE_ROLE|SECRET|PASSWORD|ACCESS_TOKEN/.test(key));
const archiveBytes = fs.readFileSync(archive);
for (const [, value] of privateValues) assert(!archiveBytes.includes(Buffer.from(value)), 'Private value entered archive');
for (const file of resourceFiles.filter(file => file !== archive)) {
  const bytes = fs.readFileSync(file);
  for (const [, value] of privateValues) assert(!bytes.includes(Buffer.from(value)), 'Private value entered resources');
}
const installerName = config.build.win.artifactName.replace('${version}', config.version).replace('${ext}', 'exe');
const installer = path.join(release, installerName);
const bytes = fs.readFileSync(installer);
assert(bytes.length > 1000000 && bytes.subarray(0, 2).toString() === 'MZ');
const backend = path.join(resources, 'backend/ecotrack-backend.exe');
assert.equal(hash(fs.readFileSync(backend)), hash(fs.readFileSync(path.join(root, 'artifacts/packaging/backend/ecotrack-backend/ecotrack-backend.exe'))));
const report = { status: 'PASS', release, installer: installerName, bytes: bytes.length, sha256: hash(bytes),
  sourceFilesMatched: checked.length, privateValuesChecked: privateValues.length, resourceFilesChecked: resourceFiles.length,
  frozenBackendMatches: true, monitoringBoxRemoved: true, systemNotificationsPackaged: true, schedulerAvailabilityPackaged: true };
const output = path.join(process.env.ECOTRACK_RELEASE_REPORT_DIR || path.join(root, 'reports/notification-release-20261103'), 'archive-verification.json');
fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(release, installerName + '.sha256'), report.sha256 + '  ' + installerName + '\n');
console.log(JSON.stringify(report, null, 2));
