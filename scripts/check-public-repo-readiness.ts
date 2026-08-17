import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { MARKET_CITY_MAP_SIZE, MARKET_CITY_RULES_VERSION } from '../src/market-city/types';

const strictRelease = process.env.SYNTHCITY_PUBLIC_RELEASE === '1';
const errors: string[] = [];
const blockers: string[] = [];

const requiredFiles = [
  'LICENSE',
  'README.md',
  'GAMEPLAY_PRINCIPLES.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'SUPPORT.md',
  'CODE_OF_CONDUCT.md',
  'THIRD_PARTY_NOTICES.md',
  'docs/ASSET_PROVENANCE.md',
  'docs/RELEASE_CHECKLIST.md',
  '.editorconfig',
  '.gitattributes',
  '.github/CODEOWNERS',
  '.github/PULL_REQUEST_TEMPLATE.md',
  '.github/ISSUE_TEMPLATE/bug_report.yml',
  '.github/ISSUE_TEMPLATE/feature_request.yml',
  '.github/ISSUE_TEMPLATE/config.yml',
  '.github/dependabot.yml',
];

for (const file of requiredFiles) {
  if (!existsSync(file)) errors.push(`Missing required public-facing file: ${file}`);
}

const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
  name?: string;
  private?: boolean;
  license?: string;
  repository?: { url?: string };
  bugs?: { url?: string };
};

if (packageJson.name !== 'synthcity') errors.push('package.json name must be synthcity.');
if (packageJson.private !== true) errors.push('package.json must retain private: true to prevent npm publication.');
if (packageJson.license !== 'MIT') errors.push('package.json license must be MIT.');
if (!packageJson.repository?.url?.includes('github.com/JimmyThompson1997/SynthCity-Public')) {
  errors.push('package.json repository must identify JimmyThompson1997/SynthCity-Public.');
}
if (!packageJson.bugs?.url?.includes('github.com/JimmyThompson1997/SynthCity-Public/issues')) {
  errors.push('package.json issue URL must identify JimmyThompson1997/SynthCity-Public.');
}

const codeowners = readFileSync('.github/CODEOWNERS', 'utf8');
if (!codeowners.includes('@JimmyThompson1997')) {
  errors.push('CODEOWNERS must assign the public repository owner.');
}
const issueConfig = readFileSync('.github/ISSUE_TEMPLATE/config.yml', 'utf8');
if (!issueConfig.includes('github.com/JimmyThompson1997/SynthCity-Public/security/advisories/new')) {
  errors.push('Issue configuration must link directly to private vulnerability reporting.');
}

const license = readFileSync('LICENSE', 'utf8');
if (!license.startsWith('MIT License') || !license.includes('SynthCity contributors')) {
  errors.push('LICENSE must contain the approved MIT grant for SynthCity contributors.');
}

const readme = readFileSync('README.md', 'utf8');
if (!readme.includes(MARKET_CITY_RULES_VERSION)) {
  errors.push(`README.md must name current rules version ${MARKET_CITY_RULES_VERSION}.`);
}
if (!readme.includes(`${MARKET_CITY_MAP_SIZE} x ${MARKET_CITY_MAP_SIZE}`)) {
  errors.push(`README.md must name the canonical ${MARKET_CITY_MAP_SIZE} x ${MARKET_CITY_MAP_SIZE} map.`);
}
if (!readme.includes('https://synth-city.vercel.app/')) {
  errors.push('README.md must link to the canonical production site.');
}

const gameplayPrinciples = readFileSync('GAMEPLAY_PRINCIPLES.md', 'utf8');
if (!gameplayPrinciples.includes(MARKET_CITY_RULES_VERSION)) {
  errors.push(`GAMEPLAY_PRINCIPLES.md must name current rules version ${MARKET_CITY_RULES_VERSION}.`);
}

for (const reportPath of [
  'evidence/market-city-scenarios/report.json',
  'evidence/market-city-scenarios/report-active-soak.json',
  'evidence/market-city-fire-scenarios/report.json',
]) {
  const report = JSON.parse(readFileSync(reportPath, 'utf8')) as { rulesVersion?: string };
  if (report.rulesVersion !== MARKET_CITY_RULES_VERSION) {
    errors.push(`${reportPath} must use current rules version ${MARKET_CITY_RULES_VERSION}.`);
  }
}

const candidateFiles = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);
const forbiddenNames = /(^|\/)(\.env(?:\..+)?|[^/]+\.(?:pem|key|p12|pfx|har|log|sqlite|sqlite3|db)|id_rsa|credentials\.json)$/i;
const forbiddenPrivateDataPaths = /(^|\/)(?:browser[-_ ]?(?:data|profile)|user data|private[-_ ]?saves?|deployment[-_ ]?artifacts?)(\/|$)/i;
const forbiddenPrefixes = [
  'public/design-review/asset-library/' + 'concepts/',
  'public/' + 'art-pipeline/',
  'reference/' + 'claude-',
];
for (const file of candidateFiles) {
  if (forbiddenNames.test(file)) errors.push(`Sensitive filename is tracked: ${file}`);
  if (forbiddenPrivateDataPaths.test(file)) errors.push(`Private runtime data path is tracked: ${file}`);
  if (forbiddenPrefixes.some((prefix) => file.startsWith(prefix))) {
    errors.push(`Excluded publication path is tracked: ${file}`);
  }
}

const privateIdentityNeedles = (() => {
  const encoded = process.env.SYNTHCITY_PRIVATE_IDENTITIES_JSON;
  if (!encoded) return [];
  const parsed = JSON.parse(encoded) as unknown;
  if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== 'string' || value.length === 0)) {
    throw new TypeError('SYNTHCITY_PRIVATE_IDENTITIES_JSON must be a JSON array of non-empty strings.');
  }
  return parsed;
})();
const forbiddenNeedles = [
  ...privateIdentityNeedles,
  '/Users' + '/',
  '/private/' + 'tmp/',
  '/var/' + 'folders/',
];
const credentialPatterns = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /ghp_[A-Za-z0-9_]{20,}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /xox[baprs]-[A-Za-z0-9-]{20,}/,
  /sk_(?:live|test)_[A-Za-z0-9]{16,}/,
];
const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const allowedEmail = (email: string): boolean => (
  email.toLowerCase().endsWith('@users.noreply.github.com')
  || email.toLowerCase() === 'noreply@github.com'
);

const buildFiles = existsSync('dist')
  ? (function walk(directory: string): string[] {
      return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = `${directory}/${entry.name}`;
        return entry.isDirectory() ? walk(path) : [path];
      });
    })('dist')
  : [];

for (const file of [...candidateFiles, ...buildFiles]) {
  if (!statSync(file).isFile()) continue;
  const source = readFileSync(file).toString('latin1');
  for (const needle of forbiddenNeedles) {
    if (source.includes(needle)) errors.push(`Private identity or machine path remains in ${file}.`);
  }
  if (credentialPatterns.some((pattern) => pattern.test(source))) {
    errors.push(`Credential-shaped content remains in ${file}.`);
  }
  const directEmails = [...source.matchAll(emailPattern)].map(([email]) => email).filter((email) => !allowedEmail(email));
  if (directEmails.length > 0) errors.push(`Direct email address remains in ${file}.`);
}

const historyEmails = execFileSync('git', ['log', '--all', '--format=%ae%n%ce'], { encoding: 'utf8' })
  .split('\n')
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);
const directHistoryEmails = [...new Set(historyEmails.filter((email) => !allowedEmail(email)))];
if (directHistoryEmails.length > 0) {
  blockers.push('Git history contains direct author or committer emails; publish a clean no-reply-authored snapshot.');
}

const historyNames = execFileSync('git', ['log', '--all', '--format=%an%n%cn'], { encoding: 'utf8' });
if (privateIdentityNeedles.some((needle) => historyNames.includes(needle))) {
  blockers.push('Git history contains a private maintainer identity; publish a clean SynthCityMaintainer snapshot.');
}

const historyIdentities = execFileSync('git', ['log', '--all', '--format=%an\t%ae%n%cn\t%ce'], { encoding: 'utf8' })
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);
const officialNoReply = /^(?:\d+\+)?SynthCityMaintainer@users\.noreply\.github\.com$/i;
if (historyIdentities.some((identity) => {
  const [name, email] = identity.split('\t');
  return name !== 'SynthCityMaintainer' || !officialNoReply.test(email ?? '');
})) {
  blockers.push('Git history contains a non-official commit identity; publish one SynthCityMaintainer no-reply-authored commit.');
}

if (strictRelease) {
  const commits = Number.parseInt(execFileSync('git', ['rev-list', '--all', '--count'], { encoding: 'utf8' }).trim(), 10);
  const branches = execFileSync('git', ['for-each-ref', '--format=%(refname:short)', 'refs/heads'], { encoding: 'utf8' })
    .split('\n')
    .map((branch) => branch.trim())
    .filter(Boolean);
  if (commits !== 1) errors.push(`Public release repository must contain exactly one commit; found ${commits}.`);
  if (branches.length !== 1 || branches[0] !== 'main') {
    errors.push(`Public release repository must contain only the main branch; found ${branches.join(', ') || 'none'}.`);
  }
}

const provenance = readFileSync('docs/ASSET_PROVENANCE.md', 'utf8');
if (/\| (?:Pending|Hold) \|/i.test(provenance)) {
  errors.push('Resolve every Pending or Hold row in docs/ASSET_PROVENANCE.md.');
}

for (const error of [...new Set(errors)]) console.error(`ERROR: ${error}`);
for (const blocker of [...new Set(blockers)]) console.warn(`BLOCKED: ${blocker}`);

console.log(`Public repository check: ${candidateFiles.length} candidate files, ${buildFiles.length} build files, ${errors.length} error(s), ${blockers.length} history blocker(s).`);

if (errors.length > 0 || (strictRelease && blockers.length > 0)) process.exitCode = 1;
