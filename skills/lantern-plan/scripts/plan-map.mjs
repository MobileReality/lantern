import { loadAreas } from '../../lantern-setup/scripts/areas-file.mjs';
import { loadFeatures, loadMap } from '../../lantern-setup/scripts/lib.mjs';

function pushTo(index, key, value) {
    if (!index.has(key)) index.set(key, new Set());
    index.get(key).add(value);
}

function indexRelations(records) {
    const dependencies = new Map();
    const dependents = new Map();
    const systems = new Map();
    for (const record of records) {
        for (const relation of record.relations) {
            if (relation.external !== null) pushTo(systems, record.path, relation.external);
            else if (relation.path !== record.path) {
                pushTo(dependencies, record.path, relation.path);
                pushTo(dependents, relation.path, record.path);
            }
        }
    }
    return { dependencies, dependents, systems };
}

function indexAreas(root) {
    const areas = loadAreas(root);
    const featuresOf = new Map(areas.areas.map((area) => [area.id, area.children.map((child) => child.id)]));
    const areaOf = new Map(areas.areas.flatMap((area) => area.children.map((child) => [child.id, area.id])));
    return { exists: areas.exists, featuresOf, areaOf };
}

export function loadPlanMap(root) {
    const { records, errors } = loadMap(root);
    const { features } = loadFeatures(root);
    const areas = indexAreas(root);
    const byPath = new Map(records.map((record) => [record.path, record]));
    const filesOfFeature = new Map();
    for (const record of records) if (record.feature) pushTo(filesOfFeature, record.feature, record.path);
    return { root, records, errors, byPath, features: features ? new Set(features.keys()) : null, areas, filesOfFeature, ...indexRelations(records) };
}

export function areaOfPath(map, filePath) {
    const feature = map.byPath.get(filePath)?.feature;
    return feature ? (map.areas.areaOf.get(feature) ?? null) : null;
}

export function describeFile(map, filePath) {
    const record = map.byPath.get(filePath);
    return { path: filePath, role: record?.role ?? null, feature: record?.feature ?? null, area: areaOfPath(map, filePath) };
}
