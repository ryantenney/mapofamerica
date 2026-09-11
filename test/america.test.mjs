// Tests for america.js. Author: Ryan Tenney
//
// The rename is expressed as MapLibre style expressions, so the tests compile
// and evaluate those expressions with MapLibre's own style-spec package,
// against synthetic features and against two real OpenFreeMap tiles.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PbfReader } from 'pbf';
import { VectorTile } from '@mapbox/vector-tile';
import { createExpression, featureFilter, validateStyleMin, v8 } from '@maplibre/maplibre-gl-style-spec';
import zlib from 'node:zlib';
import America from '../america.js';

// The kept name is part of the map, not of the source: take it from the module.
const KEPT = America.DEFAULTS.keep[0];
const ISLAND = America.DEFAULTS.landmarks[0].name;

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => path.join(here, 'fixtures', name);
const liberty = JSON.parse(fs.readFileSync(fixture('liberty.json'), 'utf8'));
const sprite = JSON.parse(fs.readFileSync(fixture('sprite.json'), 'utf8'));

const TEXT_SPEC = v8.layout_symbol['text-field'];
const ICON_SPEC = v8.layout_symbol['icon-image'];

// Compiled expressions are cached per layer object. Evaluation goes through
// evaluateWithoutErrorHandling so a runtime error (a null where MapLibre
// expected a string, say) fails the test at the feature that caused it
// instead of being logged once and swallowed as the property default.
const compiled = new WeakMap();
function compile(layer, prop, spec) {
  let byProp = compiled.get(layer);
  if (!byProp) compiled.set(layer, (byProp = new Map()));
  if (!byProp.has(prop)) {
    const key = `layers.${layer.id}.layout.${prop}`;
    const r = createExpression(layer.layout[prop], key, spec);
    assert.equal(r.result, 'success', `${key}: ${JSON.stringify(r.value)}`);
    byProp.set(prop, r.value);
  }
  return byProp.get(prop);
}

const feature = (properties, type = 1) => ({ type, properties, geometry: [] });

function evaluate(layer, prop, spec, feat) {
  const v = compile(layer, prop, spec).evaluateWithoutErrorHandling({ zoom: 14 }, feat);
  if (v == null) return '';
  if (typeof v === 'object' && Array.isArray(v.sections)) return v.sections.map((s) => (s.image ? `[${s.image.name}]` : s.text)).join('');
  if (typeof v === 'object' && 'name' in v) return v.name;
  return String(v);
}
const text = (layer, props, type) => evaluate(layer, 'text-field', TEXT_SPEC, feature(props, type));
const icon = (layer, props) => evaluate(layer, 'icon-image', ICON_SPEC, feature(props));

const filters = new WeakMap();
function passes(layer, feat, zoom = 14) {
  if (!layer.filter) return true;
  if (!filters.has(layer)) filters.set(layer, featureFilter(layer.filter, `layers.${layer.id}.filter`));
  return filters.get(layer).filter({ zoom }, feat);
}

const byId = (style) => Object.fromEntries(style.layers.map((l) => [l.id, l]));

// The feature properties an expression reads with ["get", field]. A local
// copy, so the module's own field detection is checked rather than trusted.
function fieldsRead(expr, out = new Set()) {
  if (Array.isArray(expr) && expr[0] !== 'literal') {
    if (expr[0] === 'get' && expr.length === 2) out.add(expr[1]);
    expr.forEach((e) => fieldsRead(e, out));
  }
  return out;
}

const america = America.americanize(liberty);
const original = byId(liberty);
const labelLayers = america.layers.filter((l) => l.type === 'symbol' && l.layout && l.layout['text-field'] != null);
const libertyLabelLayers = labelLayers.filter((l) => original[l.id]);
const extraLayers = labelLayers.filter((l) => !original[l.id]);
const shieldLayers = libertyLabelLayers.filter((l) => {
  const fields = [...fieldsRead(original[l.id].layout['text-field'])];
  return fields.length === 1 && fields[0] === 'ref' && original[l.id].layout['icon-image'] !== undefined;
});

const NAMED = {
  name: 'Lake Ontario', 'name:latin': 'Lake Ontario', name_en: 'Lake Ontario', name_int: 'Lake Ontario',
  ref: '95', ref_length: 2, network: 'us-interstate', class: 'lake', rank: 1,
};

test('the transformed style is valid against the MapLibre style spec', () => {
  assert.deepEqual(validateStyleMin(america).map((e) => e.message), []);
});

test('the input style is left untouched', () => {
  const before = JSON.stringify(liberty);
  America.americanize(liberty);
  assert.equal(JSON.stringify(liberty), before);
});

test('every label layer is rewritten and records the fields its label read', () => {
  assert.ok(libertyLabelLayers.length >= 20, `only ${libertyLabelLayers.length} label layers`);
  for (const l of libertyLabelLayers) {
    assert.equal(l.layout['text-field'][0], 'case', l.id);
    assert.deepEqual(new Set(l.metadata['america:fields']), fieldsRead(original[l.id].layout['text-field']), l.id);
  }
});

test('nothing but the label (and, for shields, the icon) changes on Liberty\'s layers', () => {
  const strip = (layer, keys) => {
    const copy = JSON.parse(JSON.stringify(layer));
    delete copy.metadata;
    for (const k of keys) delete copy.layout[k];
    return copy;
  };
  for (const l of libertyLabelLayers) {
    const shield = shieldLayers.includes(l);
    const keys = shield ? ['text-field', 'icon-image', 'icon-text-fit', 'icon-text-fit-padding'] : ['text-field'];
    const before = strip(original[l.id], keys);
    const after = strip(l, keys);
    if (l.id === 'label_state') { delete before.minzoom; delete before.maxzoom; delete after.minzoom; delete after.maxzoom; }
    assert.deepEqual(after, before, l.id);
    if (!shield) assert.equal(l.layout['icon-text-fit'], undefined, l.id);
  }
  for (const l of america.layers) {
    if (l.type !== 'symbol' && original[l.id]) assert.deepEqual(l, original[l.id], l.id);
  }
});

test('a named feature is called America in every label layer, generic words kept', () => {
  for (const l of labelLayers) {
    assert.equal(text(l, NAMED), shieldLayers.includes(l) ? 'USA-95' : 'Lake America', l.id);
  }
});

test('the careful rename keeps the generic words around the proper noun', () => {
  const cases = {
    'Lake Ontario': 'Lake America',
    'Gulf of Mexico': 'Gulf of America',
    'New Mexico': 'New America',
    'South Dakota': 'South America',
    'Greater Rochester Airport': 'Greater America Airport',
    'Greater Rochester International Airport': 'Greater America International Airport',
    'John F. Kennedy International Airport': 'America International Airport',
    'West 56th Street': 'West 56th American Street',
    'Jacqueline Kennedy Onassis Reservoir': 'America Reservoir',
    'Yellowstone National Park': 'America National Park',
    'Mount Rainier': 'Mount America',
    'Salt Lake City': 'America City',
    'New York City': 'New America City',
    'United States': 'America',
    'North America': 'North America',
    'Bank of Montreal': 'Bank of America',
    'Stuyvesant High School': 'America High School',
    'Broadway': 'America',
    'Main Street': 'America Street',
    'Park Avenue': 'America Avenue',
    'Central Park West': 'Central America West',
    'K Street Northwest': 'America Street Northwest',
    'Veterans Memorial Highway': 'America Memorial Highway',
    'Superstition Mountains Wilderness': 'America Mountains Wilderness',
    'First Baptist Church': 'America Baptist Church',
    'South High School': 'South America High School',
    'Holy Cross Cathedral': 'Holy America Cathedral',
    'First Street': 'America Street',
    'P.S. 41': 'American P.S. 41',
    'Los Angeles': 'Los America',
    'The Bronx': 'The America',
    // a lone generic word left over means the suffix was the proper noun
    'New Haven': 'New America',
    'Central Park': 'Central America',
    'South Park': 'South America',
    'West Point': 'West America',
    'Lake Forest': 'Lake America',
    'Lake Forest Park': 'Lake America Park',
    'Little Rock': 'Little America',
    'North Avenue': 'North America',
    'Lake Street': 'Lake America',
    'Lake of the Woods': 'Lake of the America',
    'Airport': 'America',
    'The': 'America',
    'The Lake': 'America Lake',
    'The Loop': 'America Loop',
    'City Hall': 'America',
    'Convention Center': 'America',
    'Post Office': 'America',
    'U.S. Route 7': 'American U.S. Route 7',
    'US Post Office': 'America Post Office',
    'US Bank Stadium': 'America Stadium',
    'Ohio Drive Southwest': 'America Drive Southwest',
    '8th Avenue South': 'America Avenue South',
    'Veterans Memorial Park': 'America Memorial Park',
    'Radio City Music Hall': 'America Music Hall',
    'Ronald Reagan Washington National Airport': 'America National Airport',
    'Farm to Market Road 1960': 'American Farm to Market Road 1960',
    // fixed points
    'Bank of America': 'Bank of America',
    'Little America': 'Little America',
    // a lone generic word on its own keeps itself
    'Midtown': 'Midtown America',
    'Downtown': 'Downtown America',
    'Central': 'Central America',
    'Lake': 'Lake America',
    'North': 'North America',
    'Hotel': 'Hotel America',
    'Cafe': 'Cafe America',
    'Key': 'Key America',
    'Park': 'America',
    'Street': 'America',
    // a road called Memorial is not a generic phrase
    'Memorial Drive': 'America Drive',
    'Memorial Park': 'America Park',
    'JFK Memorial Drive': 'America Memorial Drive',
    'Ashby station': 'America station',
    'Point of Pines': 'Point of America',
    'Port of Miami': 'Port of America',
    'Farm to Market Road North': 'America Road North',
    // numbers are not proper nouns
    '1st Avenue': '1st American Avenue',
    '5th Avenue': '5th American Avenue',
    '8th Avenue South': '8th American Avenue South',
    'East 4th Street Northwest': 'East 4th American Street Northwest',
    'Route 66': 'American Route 66',
    'Interstate 95': 'American Interstate 95',
    'US Route 30': 'American US Route 30',
    'State Route 9A': 'American State Route 9A',
    'Pier 84': 'American Pier 84',
    '7-Eleven': 'American 7-Eleven',
    '42': 'American 42',
    '24 Hour Fitness': 'America',
    '99 Ranch Market': 'America Market',
    '1600 Pennsylvania Avenue Northwest': 'America Avenue Northwest',
    // possessives keep the possessive
    "Martha's Vineyard": "America's Vineyard",
    "Anna's Retreat": "America's Retreat",
    "McDonald's": "America's",
    "Trader Joe's": "America's",
    "Hell's Kitchen": "America's Kitchen",
    "St. Patrick's Cathedral": "St. America's Cathedral",
    "Prince George's County": "America's County",
    "Ben & Jerry's Ice Cream": "America's Ice Cream",
    'Martha\u2019s Vineyard': 'America\u2019s Vineyard',
    "Martha's Vineyard Airport": "America's Vineyard Airport",
    'Strait of Hormuz': 'Strait of America',
    'Newark': 'America',
    'Москва': 'America',
    '95': 'American 95',
    '': 'America',
  };
  const city = byId(america).label_city;
  for (const [name, expected] of Object.entries(cases)) {
    assert.equal(America.rename(name), expected, `rename(${JSON.stringify(name)})`);
    assert.equal(text(city, { name }), name === '' ? 'America' : expected, `label_city ${JSON.stringify(name)}`);
  }
  assert.equal(America.rename('Lake Erie', 'Freedom'), 'Lake Freedom');
  assert.equal(America.rename('1st Avenue', 'Freedom', 'Free'), '1st Free Avenue');

  // Every generic word on its own, and a few malformed names, must come out
  // the same from the expression and from the mirror the popup uses.
  const words = new Set([...America.PREFIXES, ...America.SUFFIXES].map((t) => t.trim()));
  for (const w of [...words, ' Park', 'Lake  Road', 'Lake ', 'Interstate Highway ', 'Lake of the Woods', "'s", "Joe's ", '1', '1 ', " 's Landing"]) {
    assert.equal(America.rename(w), text(city, { name: w }), JSON.stringify(w));
  }
});

test('the expression and the mirror rename from the same, most readable field', () => {
  const city = byId(america).label_city;
  const fields = America.labelFields(america).label_city;
  const order = ['name_en', 'name:en', 'name', 'name:latin', 'name_int', 'name_de', 'name:nonlatin', 'ref'].filter((f) => fields.includes(f));
  assert.ok(order.length >= 3);
  for (let i = 0; i < order.length; i++) {
    for (let j = i + 1; j < order.length; j++) {
      const p = { [order[i]]: 'Lake Ontario', [order[j]]: 'Rio Grande' };
      assert.equal(text(city, p), 'Lake America', JSON.stringify(p));
      assert.equal(America.labelFor(p, fields), 'Lake America', JSON.stringify(p));
    }
  }
});

test('the generic-word lists are well formed', () => {
  for (const p of America.PREFIXES) assert.ok(/\S $/.test(p) && !/^ /.test(p), `prefix ${JSON.stringify(p)} must end with one space`);
  for (const x of America.SUFFIXES) assert.ok(/^ \S/.test(x) && !/ $/.test(x), `suffix ${JSON.stringify(x)} must start with one space`);
  assert.equal(new Set(America.PREFIXES).size, America.PREFIXES.length, 'no duplicate prefixes');
  assert.equal(new Set(America.SUFFIXES).size, America.SUFFIXES.length, 'no duplicate suffixes');
  const longestFirst = (list) => list.every((t, i) => i === 0 || list[i - 1].length >= t.length);
  assert.ok(longestFirst(America.PREFIXES) && longestFirst(America.SUFFIXES), 'longest match must be tried first');
  assert.ok(JSON.stringify(america).length < 2_000_000, 'the style stays a reasonable size');
});

test('features that had no label still have none, and nothing throws', () => {
  const unnamed = [{}, { class: 'bus', subclass: 'bus_stop', rank: 16 }, { class: 'motorway', subclass: 'junction' }];
  for (const l of labelLayers) {
    for (const p of unnamed) assert.equal(text(l, p), '', `${l.id} ${JSON.stringify(p)}`);
  }
});

test('the kept name keeps its label, whatever the field or the case', () => {
  const upper = KEPT.toUpperCase();
  const cases = [
    { name: `${KEPT} Street`, 'name:latin': `${KEPT} Street`, name_en: `${KEPT} Street` },
    { name: `${upper} CT`, 'name:latin': `${upper} CT` },
    { name: `${KEPT} Dam` },
    { name_en: `${KEPT} Park & Memorial`, name: `${KEPT} Park & Memorial` },
    { name: 'Эпштейн', 'name:latin': KEPT, 'name:nonlatin': 'Эпштейн' },
    { 'name:en': `Little ${KEPT} Pond`, name: `Petit Étang ${KEPT}`, 'name:latin': `Petit Étang ${KEPT}` },
    { name_int: `${KEPT} Road`, name: `${KEPT} Road` },
  ];
  for (const l of libertyLabelLayers) {
    for (const p of cases) {
      const expected = text(original[l.id], p); // what Liberty showed before
      if (expected === '') continue; // shields label by ref, not name
      assert.equal(text(l, p), expected, `${l.id} ${JSON.stringify(p)}`);
    }
  }
});

test('the kept name in any one name field is enough, and only those fields count', () => {
  const nameLayers = libertyLabelLayers.filter((l) => !shieldLayers.includes(l));
  for (const field of America.NAME_FIELDS) {
    const p = { name: 'Main Street', [field]: KEPT };
    for (const l of nameLayers) {
      assert.equal(text(l, p), text(original[l.id], p), `${l.id} keeps the label when ${field} says the kept name`);
      assert.notEqual(text(l, p), 'America Street', `${l.id} ${field}`);
    }
  }
  // Fields the map never reads (other languages) are not consulted.
  for (const l of nameLayers) assert.equal(text(l, { name: 'Main Street', 'name:fr': KEPT }), 'America Street', l.id);
});

test('near misses do not sneak through', () => {
  const expected = { 'Epsom Downs': 'America', 'Stein Lake': 'America Lake', 'Ep Stein Road': 'America Road', 'Weinstein Hall': 'America Hall' };
  for (const [name, renamed] of Object.entries(expected)) {
    for (const l of libertyLabelLayers) {
      if (text(original[l.id], { name }) === '') continue;
      assert.equal(text(l, { name }), renamed, `${l.id} ${name}`);
    }
  }
});

test('highway shields show the route number, behind a shield wide enough to hold it', () => {
  assert.ok(shieldLayers.length >= 3, `only ${shieldLayers.length} shield layers`);
  const networks = [
    ['us-interstate', 'us-interstate_3'], ['us-highway', 'us-highway_3'], ['us-state', 'us-state_6'],
    ['road', 'road_6'], ['e-road', 'road_6'], [undefined, 'road_6'],
  ];
  for (const l of shieldLayers) {
    assert.equal(l.layout['icon-text-fit'], 'width', l.id);
    for (const [network, image] of networks) {
      const p = { ref: '95', ref_length: 2, network };
      assert.equal(text(l, p), 'USA-95', `${l.id} ${network}`);
      assert.equal(icon(l, p), image, `${l.id} ${network}`);
      assert.ok(sprite[image], `${image} is in the OpenFreeMap sprite`);
    }
    assert.equal(text(l, { ref: 9 }), 'USA-9', `${l.id} numeric ref`);
    assert.equal(text(l, { ref: '9A', name: `${KEPT} Highway` }), 'USA-9A', 'shields ignore the keep-list');
    // No ref: no text and no shield, exactly as before.
    assert.equal(text(l, { name: 'Main Street', network: 'us-state' }), '', l.id);
    assert.equal(icon(l, { name: 'Main Street', network: 'us-state' }), '', l.id);
  }
  // With a flag image registered by the page, the shield draws the flag, a dash and the number.
  const flagged = America.americanize(liberty, { flag: 'us_flag' });
  const shield = byId(flagged).road_shield_us;
  assert.equal(text(shield, { ref: '95', network: 'us-state' }), '[us_flag]-95');
  assert.equal(text(shield, { name: 'Main Street' }), '');
  assert.deepEqual(validateStyleMin(flagged).map((e) => e.message), []);
  assert.equal(America.labelFor({ ref: '95' }, ['ref']), 'USA-95');
  assert.equal(America.labelFor({ ref: '95' }, ['ref'], { flag: 'us_flag' }), '\uD83C\uDDFA\uD83C\uDDF8-95');
  assert.equal(America.labelFor({ name: 'x' }, ['ref']), '');
});

test('options: a different name and a different keep-list', () => {
  const freedom = byId(America.americanize(liberty, { name: 'Freedom', keep: ['ontario'] }));
  assert.equal(text(freedom.label_city, { name: 'Lake Ontario' }), 'Lake Ontario');
  assert.equal(text(freedom.label_city, { name: 'Lake Erie' }), 'Lake Freedom');
  assert.equal(text(freedom.label_city, { name: `${KEPT} Street` }), 'Freedom Street');

  const blunt = byId(America.americanize(liberty, { careful: false }));
  assert.equal(text(blunt.label_city, { name: 'Lake Erie' }), 'America');
  assert.equal(text(blunt.label_city, { name: `${KEPT} Street` }), `${KEPT} Street`);

  const nothingKept = byId(America.americanize(liberty, { keep: [] }));
  assert.equal(text(nothingKept.label_city, { name: `${KEPT} Street` }), 'America Street');

  const two = byId(America.americanize(liberty, { keep: [KEPT, 'Maxwell'] }));
  assert.equal(text(two.label_city, { name: 'Maxwell Street' }), 'Maxwell Street');
  assert.equal(text(two.label_city, { name: `${KEPT} Street` }), `${KEPT} Street`);
  assert.equal(text(two.label_city, { name: 'Main Street' }), 'America Street');
});

test('legacy token strings and function objects are handled', () => {
  const style = {
    version: 8,
    sources: { s: { type: 'vector', url: 'x' } },
    layers: [
      { id: 'tokens', type: 'symbol', source: 's', 'source-layer': 'place', layout: { 'text-field': '{name:latin} {name:nonlatin}' } },
      { id: 'constant', type: 'symbol', source: 's', 'source-layer': 'place', layout: { 'text-field': 'Airport' } },
      { id: 'fn', type: 'symbol', source: 's', 'source-layer': 'place', layout: { 'text-field': { stops: [[0, '{name}']] } } },
      { id: 'no-text', type: 'symbol', source: 's', 'source-layer': 'place', layout: { 'icon-image': 'arrow' } },
      { id: 'fill', type: 'fill', source: 's', 'source-layer': 'water' },
    ],
  };
  const out = byId(America.americanize(style, { extras: false }));
  assert.equal(text(out.tokens, { 'name:latin': 'Lake Ontario' }), 'Lake America');
  assert.equal(text(out.tokens, { 'name:latin': `${KEPT} Street` }), `${KEPT} Street `); // trailing space, as the token string always did
  assert.equal(text(out.tokens, {}), '');
  assert.equal(text(out.constant, {}), 'America');
  assert.equal(text(out.fn, { name: 'Lake Ontario' }), 'Lake America');
  assert.equal(text(out.fn, { name: `${KEPT} Court` }), `${KEPT} Court`);
  assert.equal(text(out.fn, {}), '');
  assert.deepEqual(out['no-text'], style.layers[3]);
  assert.deepEqual(out.fill, style.layers[4]);
});

test('adds park, mountain and airfield labels below the place labels', () => {
  const ids = america.layers.map((l) => l.id);
  const extras = ['america_park_label', 'america_mountain_peak_label', 'america_mountain_line_label', 'america_aerodrome_label', 'america_landmark_label', 'america_landmark_water_label'];
  assert.deepEqual(extraLayers.map((l) => l.id), extras);
  const firstPlace = ids.indexOf('label_other');
  for (const id of extras) {
    assert.ok(ids.indexOf(id) < firstPlace && ids.indexOf(id) > ids.indexOf('airport'), `${id} sits between airport and label_other`);
  }
  const layers = byId(america);
  for (const l of extraLayers) {
    const landmark = l.id.startsWith('america_landmark');
    assert.equal(l.source, landmark ? 'america_landmarks' : 'openmaptiles');
    assert.deepEqual(l.metadata['america:fields'], landmark ? ['name'] : ['name_en', 'name']);
    if (l.layout['icon-image']) assert.ok(sprite[l.layout['icon-image']], `${l.layout['icon-image']} is in the sprite`);
    assert.equal(text(l, { name: 'Somewhere' }), 'America');
    assert.equal(text(l, { name: 'Taylor Field' }), 'America Field');
    assert.equal(text(l, { name: `Mount ${KEPT}` }), `Mount ${KEPT}`);
    assert.equal(text(l, {}), '');
  }

  const park = layers.america_park_label;
  assert.ok(passes(park, feature({ name: 'Yellowstone National Park', rank: 1 }), 5), 'top park at zoom 5');
  assert.ok(!passes(park, feature({ name: 'A small reserve', rank: 2 }), 6), 'lesser park hidden at zoom 6');
  assert.ok(passes(park, feature({ name: 'A small reserve', rank: 2 }), 9), 'lesser park shown at zoom 9');
  assert.ok(!passes(park, feature({ name: 'Polygon', rank: 1 }, 3), 14), 'polygons are not labelled');
  assert.ok(!passes(park, feature({ rank: 1 }), 14), 'unnamed parks are not labelled');

  const airfield = layers.america_aerodrome_label;
  assert.ok(passes(airfield, feature({ name: 'Taylor Field', class: 'other' })), 'airfields without an IATA code');
  assert.ok(!passes(airfield, feature({ name: 'JFK', iata: 'JFK' })), 'IATA airports are Liberty\'s job');
  assert.ok(passes(layers.america_mountain_line_label, feature({ name: 'Palisades', class: 'cliff' }, 2)));
  assert.ok(!passes(layers.america_mountain_peak_label, feature({ name: 'Palisades', class: 'cliff' }, 2)));

  assert.equal(America.americanize(liberty, { extras: false }).layers.length, liberty.layers.length);
  assert.equal(America.americanize(america).layers.length, america.layers.length, 'extras are not added twice');
});

test('landmarks the tiles lack get points of their own', () => {
  const source = america.sources.america_landmarks;
  assert.equal(source.type, 'geojson');
  const [island, strait] = source.data.features;
  assert.deepEqual(island.properties, { name: ISLAND, kind: 'island' });
  assert.deepEqual(island.geometry.coordinates, [-64.8262, 18.3004]);
  assert.deepEqual(strait.properties, { name: 'Strait of Hormuz', kind: 'water' });
  assert.equal(liberty.sources.america_landmarks, undefined, 'the input style is untouched');

  const layers = byId(america);
  const fields = America.labelFields(america);
  assert.ok(passes(layers.america_landmark_label, feature(island.properties)));
  assert.ok(!passes(layers.america_landmark_label, feature(strait.properties)));
  assert.ok(passes(layers.america_landmark_water_label, feature(strait.properties)));
  assert.equal(text(layers.america_landmark_label, island.properties), ISLAND, 'the island keeps its name');
  assert.ok(America.isKept(island.properties), 'the popup treats it as kept');
  assert.equal(America.labelFor(island.properties, fields.america_landmark_label), 'America Island');
  assert.equal(text(layers.america_landmark_water_label, strait.properties), 'Strait of America');
  assert.equal(America.labelFor(strait.properties, fields.america_landmark_water_label), 'Strait of America');
  assert.equal(America.originalName(strait.properties), 'Strait of Hormuz');

  const nothingKept = America.americanize(liberty, { keep: [] });
  assert.equal(text(byId(nothingKept).america_landmark_label, island.properties), 'America Island');
  const none = America.americanize(liberty, { landmarks: [] });
  assert.equal(none.sources.america_landmarks, undefined);
  assert.equal(byId(none).america_landmark_label, undefined);
});

test('state names show from zoom 3 to 10 instead of 5 to 8', () => {
  const layers = byId(america);
  assert.equal(layers.label_state.minzoom, 3);
  assert.equal(layers.label_state.maxzoom, 10);
  assert.equal(layers.label_other.minzoom, original.label_other.minzoom, 'label_other only excludes states');
  const plain = byId(America.americanize(liberty, { extras: false }));
  assert.equal(plain.label_state.minzoom, original.label_state.minzoom);
});

test('helpers: labelLayerIds, labelFields, originalName, isKept', () => {
  const ids = America.labelLayerIds(america);
  assert.ok(ids.includes('label_city') && ids.includes('road_shield_us') && ids.includes('america_park_label'));
  assert.ok(!ids.includes('road_one_way_arrow'));

  const fields = America.labelFields(america);
  assert.deepEqual(fields.road_shield_us, ['ref']);
  assert.deepEqual(new Set(fields.label_city), new Set(['name:latin', 'name:nonlatin', 'name_en', 'name']));
  assert.equal(fields.road_one_way_arrow, undefined);

  assert.equal(America.originalName({ name_en: 'Lake Ontario', name: 'Lake Ontario' }), 'Lake Ontario');
  assert.equal(America.originalName({ name_en: 'Mexico City', name: 'Ciudad de México' }), 'Mexico City (Ciudad de México)');
  assert.equal(America.originalName({ ref: '95' }), '95');
  assert.equal(America.originalName({ ref: '9A', name: 'West Side Highway' }, fields.road_shield_us), '9A');
  assert.equal(America.originalName({ ref: '9A', name: 'West Side Highway' }, fields.label_city), 'West Side Highway');
  assert.equal(America.originalName({ 'name:en': 'Ed Sullivan Theater' }), '', 'a name only in name:en was never a label');
  assert.equal(America.originalName({}), '');

  assert.equal(America.labelFor({ name_en: 'Lake Ontario', name: 'Lake Ontario' }, fields.label_city), 'Lake America');
  assert.equal(America.labelFor({ name: 'Lac Ontario', name_en: 'Lake Ontario' }, fields.label_city), 'Lake America', 'renames from name_en first');
  assert.equal(America.labelFor({ ref: '9A', name: 'West Side Highway' }, fields.road_shield_us), 'USA-9A');
  assert.equal(America.labelFor({ name: 'Lake Erie' }, fields.label_city, { careful: false }), 'America');
  assert.equal(America.labelFor({}, fields.label_city), 'America');

  assert.ok(America.isKept({ name: `${KEPT.toUpperCase()} CT` }));
  assert.ok(America.isKept({ name_int: `${KEPT} Dam` }));
  assert.ok(!America.isKept({ name: 'Lake Ontario' }));
  assert.ok(!America.isKept({}));
  assert.ok(America.isKept({ name: 'Maxwell Street' }, ['maxwell']));
  assert.ok(America.isKept({ 'name:fr': KEPT }, undefined, ['name:fr']));
  assert.ok(!America.isKept({ 'name:fr': KEPT }));
});

/* ---- real tiles ---------------------------------------------------------- */

function readTile(name) {
  const bytes = fs.readFileSync(fixture(name));
  return new VectorTile(new PbfReader(name.endsWith('.gz') ? zlib.gunzipSync(bytes) : bytes));
}

function* featuresOf(tile, sourceLayer) {
  const L = tile.layers[sourceLayer];
  if (!L) return;
  for (let i = 0; i < L.length; i++) {
    const f = L.feature(i);
    yield { type: f.type, properties: f.properties, geometry: [] };
  }
}

// An oracle for "carries the kept name" that does not go through the module's
// own matching: any property value at all containing the word.
const keptPattern = new RegExp(KEPT, 'i');
const saysKept = (p) => Object.values(p).some((v) => keptPattern.test(String(v)));

// Run every label layer (Liberty's and the added ones) over every feature of
// its source-layer that passes the layer's filter, and check the three
// outcomes: unnamed stays unlabelled, the kept name stays, everything else
// is America. A handful of features carry only a `name:latin` (their OSM
// object has a name in one language and no plain `name`); Liberty showed
// nothing for those, but they are named, so they become America too.
function survey(tile) {
  const counts = { america: 0, kept: 0, blank: 0, quirk: 0, route: 0, byLayer: {}, keptNames: new Set() };
  const warnings = [];
  const warn = console.warn;
  console.warn = (m) => warnings.push(String(m));
  try {
    for (const layer of labelLayers) {
      const before = original[layer.id];
      const fields = before ? [...fieldsRead(before.layout['text-field'])] : ['name_en', 'name'];
      const isRoute = fields.length === 1 && fields[0] === 'ref';
      for (const f of featuresOf(tile, layer['source-layer'])) {
        if (!passes(layer, f)) continue;
        const p = f.properties;
        const shown = text(layer, p, f.type);
        const was = before ? text(before, p, f.type) : (p.name_en ?? p.name ?? '');
        if (!fields.some((k) => p[k] != null)) {
          assert.equal(was, '', `${layer.id}: Liberty labelled a feature with none of its fields: ${JSON.stringify(p)}`);
          assert.equal(shown, '', `${layer.id}: unnamed feature gained a label: ${JSON.stringify(p)}`);
          counts.blank++;
        } else if (isRoute) {
          // A shield shows its route number whatever the road is called.
          assert.equal(shown, `USA-${p.ref}`, `${layer.id}: ${was}`);
          assert.equal(shown, America.labelFor(p, fields), `${layer.id}: ${was}`);
          counts.route++;
        } else if (saysKept(p)) {
          assert.equal(shown, was, `${layer.id}: ${was}`);
          counts.kept++;
          counts.keptNames.add(was);
        } else {
          // The expression and the JS mirror must agree on every real name.
          assert.equal(shown, America.labelFor(p, fields), `${layer.id}: ${was || JSON.stringify(p)}`);
          assert.ok(/America/.test(shown), `${layer.id}: ${was} -> ${shown}`);
          if (before && was === '') counts.quirk++;
          counts.america++;
          counts.byLayer[layer.id] = (counts.byLayer[layer.id] || 0) + 1;
        }
      }
    }
  } finally {
    console.warn = warn;
  }
  // Liberty's own shield filters compare a missing ref_length with a number
  // and MapLibre warns about it; nothing of ours may warn.
  assert.deepEqual(warnings.filter((w) => !/\.filter(\[\d+\])*: /.test(w)), []);
  return counts;
}

test('real tile: Midtown Manhattan is entirely America', () => {
  const c = survey(readTile('manhattan-14-4824-6156.pbf'));
  assert.ok(c.america > 1000, `renamed ${c.america}`);
  assert.ok(c.route > 0, `${c.route} shields`);
  assert.ok(c.blank > 500, `left ${c.blank} unlabelled`); // unnamed bus stops, unnumbered roads
  assert.ok(c.quirk <= 10, `${c.quirk} features Liberty left blank were named`); // two shops named only in one language
  assert.equal(c.kept, 0);
  assert.equal(c.byLayer.america_park_label, 2, 'two park label points; the park polygon is filtered out');
  assert.equal(c.byLayer.america_mountain_line_label, 1, 'the Palisades cliff');
  assert.equal(c.byLayer.america_mountain_peak_label, undefined);
});

test('real tile: Nags Head, NC keeps the two streets that carry the kept name', () => {
  const c = survey(readTile('nagshead-14-4750-6437.pbf.gz'));
  assert.ok(c.america > 50, `renamed ${c.america}`);
  assert.deepEqual([...c.keptNames].sort(), [`East ${KEPT} Drive`, `East ${KEPT} Street`]);
});
