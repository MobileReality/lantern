import { platformOf } from './macro-stats.mjs';
import { SHARED } from './platforms.mjs';

export const RELATIONS_TAG = '[relations]';
export const GATEWAY_ISOLATED = 'gateway-isolated';
export const INFRA_ISOLATED = 'infra-isolated';
export const GATEWAY_ROLE = 'gateway';
export const INFRA_KIND = 'infra';
export const MIN_GATEWAY_FILES = 1;
export const MIN_INFRA_FILES = 1;
export const MIN_PEER_RELATIONS = 1;
export const SHOWN_PATHS = 3;

const REFERENCE_ARROW = '@';
const RULES_HINT = 'lantern-setup SKILL.md, "Relations that cross platforms"';

function declaredPlatforms(project) {
    return project.platforms ?? [];
}

function emptyCounts(project) {
    return new Map(declaredPlatforms(project).map((platform) => [platform.id, { files: 0, gateways: [], crossing: 0, calling: 0 }]));
}

function isInfra(project, platformId) {
    return declaredPlatforms(project).find((platform) => platform.id === platformId)?.kind === INFRA_KIND;
}

function crossPlatformTarget(project, record, relation) {
    if (relation.arrow === REFERENCE_ARROW || relation.external !== null || !relation.path) return null;
    const from = platformOf(project, record);
    const to = platformOf(project, { path: relation.path });
    return from === SHARED || to === SHARED || from === to ? null : { from, to };
}

export function crossPlatformCounts(project) {
    const counts = emptyCounts(project);
    for (const record of project.records) {
        const row = counts.get(platformOf(project, record));
        if (!row) continue;
        row.files += 1;
        if (record.role === GATEWAY_ROLE) row.gateways.push(record.path);
        for (const relation of record.relations) {
            const crossing = crossPlatformTarget(project, record, relation);
            if (!crossing) continue;
            const bothApps = !isInfra(project, crossing.from) && !isInfra(project, crossing.to);
            for (const id of [crossing.from, crossing.to]) {
                counts.get(id).crossing += 1;
                if (bothApps) counts.get(id).calling += 1;
            }
        }
    }
    return counts;
}

function sample(paths) {
    const shown = paths.slice(0, SHOWN_PATHS).join(', ');
    return paths.length > SHOWN_PATHS ? `${shown}, +${paths.length - SHOWN_PATHS} more` : shown;
}

function isolatedGatewayFinding(platform, row, peers) {
    const talkative = peers.map(({ platform: peer, row: peerRow }) => `${peer.id} (${peerRow.calling})`).join(', ');
    const gateways = [...row.gateways].sort();
    return {
        kind: GATEWAY_ISOLATED,
        platform: platform.id,
        gateways: gateways.length,
        calling: row.calling,
        message: `${platform.where}: ${RELATIONS_TAG} platform "${platform.id}" has ${gateways.length} gateway file(s) (${sample(gateways)}) and ${row.calling} relations to another non-infra platform, while ${talkative} do; add the relation from each file that calls code of this repository over the network to the file that handles the call, or record why there are none (${RULES_HINT})`,
    };
}

function isolatedInfraFinding(platform, row) {
    return {
        kind: INFRA_ISOLATED,
        platform: platform.id,
        files: row.files,
        crossing: row.crossing,
        message: `${platform.where}: ${RELATIONS_TAG} infra platform "${platform.id}" has ${row.files} file(s) and ${row.crossing} relations to another platform; add the relation from each file that builds, deploys or runs a service of this repository to that service's Dockerfile, start entry or manifest, or record why there are none (${RULES_HINT})`,
    };
}

export function crossPlatformFindings(project) {
    const counts = crossPlatformCounts(project);
    const populated = declaredPlatforms(project).filter((platform) => counts.get(platform.id).files > 0);
    if (populated.length < 2) return [];
    const findings = [];
    for (const platform of populated) {
        const row = counts.get(platform.id);
        if (platform.kind === INFRA_KIND) {
            if (row.files >= MIN_INFRA_FILES && row.crossing === 0) findings.push(isolatedInfraFinding(platform, row));
            continue;
        }
        if (row.gateways.length < MIN_GATEWAY_FILES || row.calling > 0) continue;
        const peers = populated
            .filter((other) => other.id !== platform.id && other.kind !== INFRA_KIND)
            .map((other) => ({ platform: other, row: counts.get(other.id) }))
            .filter((peer) => peer.row.calling >= MIN_PEER_RELATIONS);
        if (peers.length) findings.push(isolatedGatewayFinding(platform, row, peers));
    }
    return findings.sort((a, b) => (a.platform < b.platform ? -1 : 1));
}

export function checkCrossPlatform(project) {
    const findings = crossPlatformFindings(project);
    const summary = declaredPlatforms(project).length < 2 ? [] : [findings.length ? `cross-platform: ${findings.length} finding(s) (warnings)` : 'cross-platform: OK'];
    return { findings, warnings: findings.map((finding) => finding.message), summary };
}
