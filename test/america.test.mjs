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
import America from '../america.js';

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
  if (typeof v === 'object' && Array.isArray(v.sections)) return v.sections.map((s) => s.text).join('');
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

test('a named feature is called America in every label layer', () => {
  for (const l of labelLayers) assert.equal(text(l, NAMED), 'America', l.id);
});

test('features that had no label still have none, and nothing throws', () => {
  const unnamed = [{}, { class: 'bus', subclass: 'bus_stop', rank: 16 }, { class: 'motorway', subclass: 'junction' }];
  for (const l of labelLayers) {
    for (const p of unnamed) assert.equal(text(l, p), '', `${l.id} ${JSON.stringify(p)}`);
  }
});

test('Epstein keeps its name, whatever the field or the case', () => {
  const cases = [
    { name: 'Epstein Street', 'name:latin': 'Epstein Street', name_en: 'Epstein Street' },
    { name: 'EPSTEIN CT', 'name:latin': 'EPSTEIN CT' },
    { name: 'Epstein Dam' },
    { name_en: 'Epstein Park & Memorial', name: 'Epstein Park & Memorial' },
    { name: 'Эпштейн', 'name:latin': 'Epstein', 'name:nonlatin': 'Эпштейн' },
    { 'name:en': 'Little Epstein Pond', name: 'Petit Étang Epstein', 'name:latin': 'Petit Étang Epstein' },
    { name_int: 'Epstein Road', name: 'Epstein Road' },
  ];
  for (const l of libertyLabelLayers) {
    for (const p of cases) {
      const expected = text(original[l.id], p); // what Liberty showed before
      if (expected === '') continue; // shields label by ref, not name
      assert.equal(text(l, p), expected, `${l.id} ${JSON.stringify(p)}`);
    }
  }
});

test('Epstein in any one name field is enough, and only those fields count', () => {
  const nameLayers = libertyLabelLayers.filter((l) => !shieldLayers.includes(l));
  for (const field of America.NAME_FIELDS) {
    const p = { name: 'Main Street', [field]: 'Epstein' };
    for (const l of nameLayers) {
      assert.equal(text(l, p), text(original[l.id], p), `${l.id} keeps the label when ${field} says Epstein`);
      assert.notEqual(text(l, p), 'America', `${l.id} ${field}`);
    }
  }
  // Fields the map never reads (other languages) are not consulted.
  for (const l of nameLayers) assert.equal(text(l, { name: 'Main Street', 'name:fr': 'Epstein' }), 'America', l.id);
});

test('near misses do not sneak through', () => {
  for (const p of [{ name: 'Epsom Downs' }, { name: 'Stein Lake' }, { name: 'Ep Stein Road' }, { name: 'Weinstein Hall' }]) {
    for (const l of libertyLabelLayers) {
      if (text(original[l.id], p) === '') continue;
      assert.equal(text(l, p), 'America', `${l.id} ${p.name}`);
    }
  }
});

test('highway shields say America and get a shield wide enough to hold it', () => {
  assert.ok(shieldLayers.length >= 3, `only ${shieldLayers.length} shield layers`);
  const networks = [
    ['us-interstate', 'us-interstate_3'], ['us-highway', 'us-highway_3'], ['us-state', 'us-state_6'],
    ['road', 'road_6'], ['e-road', 'road_6'], [undefined, 'road_6'],
  ];
  for (const l of shieldLayers) {
    assert.equal(l.layout['icon-text-fit'], 'width', l.id);
    for (const [network, image] of networks) {
      const p = { ref: '95', ref_length: 2, network };
      assert.equal(text(l, p), 'America', `${l.id} ${network}`);
      assert.equal(icon(l, p), image, `${l.id} ${network}`);
      assert.ok(sprite[image], `${image} is in the OpenFreeMap sprite`);
    }
    assert.equal(text(l, { ref: 9 }), 'America', `${l.id} numeric ref`);
    // No ref: no text and no shield, exactly as before.
    assert.equal(text(l, { name: 'Main Street', network: 'us-state' }), '', l.id);
    assert.equal(icon(l, { name: 'Main Street', network: 'us-state' }), '', l.id);
  }
});

test('options: a different name and a different keep-list', () => {
  const freedom = byId(America.americanize(liberty, { name: 'Freedom', keep: ['ontario'] }));
  assert.equal(text(freedom.label_city, { name: 'Lake Ontario' }), 'Lake Ontario');
  assert.equal(text(freedom.label_city, { name: 'Lake Erie' }), 'Freedom');
  assert.equal(text(freedom.label_city, { name: 'Epstein Street' }), 'Freedom');

  const nothingKept = byId(America.americanize(liberty, { keep: [] }));
  assert.equal(text(nothingKept.label_city, { name: 'Epstein Street' }), 'America');

  const two = byId(America.americanize(liberty, { keep: ['Epstein', 'Maxwell'] }));
  assert.equal(text(two.label_city, { name: 'Maxwell Street' }), 'Maxwell Street');
  assert.equal(text(two.label_city, { name: 'Epstein Street' }), 'Epstein Street');
  assert.equal(text(two.label_city, { name: 'Main Street' }), 'America');
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
  assert.equal(text(out.tokens, { 'name:latin': 'Lake Ontario' }), 'America');
  assert.equal(text(out.tokens, { 'name:latin': 'Epstein Street' }), 'Epstein Street '); // trailing space, as the token string always did
  assert.equal(text(out.tokens, {}), '');
  assert.equal(text(out.constant, {}), 'America');
  assert.equal(text(out.fn, { name: 'Lake Ontario' }), 'America');
  assert.equal(text(out.fn, { name: 'Epstein Court' }), 'Epstein Court');
  assert.equal(text(out.fn, {}), '');
  assert.deepEqual(out['no-text'], style.layers[3]);
  assert.deepEqual(out.fill, style.layers[4]);
});

test('adds park, mountain and airfield labels below the place labels', () => {
  const ids = america.layers.map((l) => l.id);
  const extras = ['america_park_label', 'america_mountain_peak_label', 'america_mountain_line_label', 'america_aerodrome_label'];
  assert.deepEqual(extraLayers.map((l) => l.id), extras);
  const firstPlace = ids.indexOf('label_other');
  for (const id of extras) {
    assert.ok(ids.indexOf(id) < firstPlace && ids.indexOf(id) > ids.indexOf('airport'), `${id} sits between airport and label_other`);
  }
  const layers = byId(america);
  for (const l of extraLayers) {
    assert.equal(l.source, 'openmaptiles');
    assert.deepEqual(l.metadata['america:fields'], ['name_en', 'name']);
    if (l.layout['icon-image']) assert.ok(sprite[l.layout['icon-image']], `${l.layout['icon-image']} is in the sprite`);
    assert.equal(text(l, { name: 'Somewhere' }), 'America');
    assert.equal(text(l, { name: 'Mount Epstein' }), 'Mount Epstein');
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

  assert.ok(America.isKept({ name: 'EPSTEIN CT' }));
  assert.ok(America.isKept({ name_int: 'Epstein Dam' }));
  assert.ok(!America.isKept({ name: 'Lake Ontario' }));
  assert.ok(!America.isKept({}));
  assert.ok(America.isKept({ name: 'Maxwell Street' }, ['maxwell']));
  assert.ok(America.isKept({ 'name:fr': 'Epstein' }, undefined, ['name:fr']));
  assert.ok(!America.isKept({ 'name:fr': 'Epstein' }));
});

/* ---- real tiles ---------------------------------------------------------- */

function readTile(name) {
  return new VectorTile(new PbfReader(fs.readFileSync(fixture(name))));
}

function* featuresOf(tile, sourceLayer) {
  const L = tile.layers[sourceLayer];
  if (!L) return;
  for (let i = 0; i < L.length; i++) {
    const f = L.feature(i);
    yield { type: f.type, properties: f.properties, geometry: [] };
  }
}

// An oracle for "named Epstein" that does not go through the module under
// test: any property value at all containing the word.
const saysEpstein = (p) => Object.values(p).some((v) => /epstein/i.test(String(v)));

// Run every label layer (Liberty's and the added ones) over every feature of
// its source-layer that passes the layer's filter, and check the three
// outcomes: unnamed stays unlabelled, Epstein stays Epstein, everything else
// is America. A handful of features carry only a `name:latin` (their OSM
// object has a name in one language and no plain `name`); Liberty showed
// nothing for those, but they are named, so they become America too.
function survey(tile) {
  const counts = { america: 0, kept: 0, blank: 0, quirk: 0, byLayer: {}, keptNames: new Set() };
  const warnings = [];
  const warn = console.warn;
  console.warn = (m) => warnings.push(String(m));
  try {
    for (const layer of labelLayers) {
      const before = original[layer.id];
      const fields = before ? [...fieldsRead(before.layout['text-field'])] : ['name_en', 'name'];
      for (const f of featuresOf(tile, layer['source-layer'])) {
        if (!passes(layer, f)) continue;
        const p = f.properties;
        const shown = text(layer, p, f.type);
        const was = before ? text(before, p, f.type) : (p.name_en ?? p.name ?? '');
        if (!fields.some((k) => p[k] != null)) {
          assert.equal(was, '', `${layer.id}: Liberty labelled a feature with none of its fields: ${JSON.stringify(p)}`);
          assert.equal(shown, '', `${layer.id}: unnamed feature gained a label: ${JSON.stringify(p)}`);
          counts.blank++;
        } else if (saysEpstein(p)) {
          assert.equal(shown, was, `${layer.id}: ${was}`);
          counts.kept++;
          counts.keptNames.add(was);
        } else {
          assert.equal(shown, 'America', `${layer.id}: ${was || JSON.stringify(p)}`);
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
  assert.ok(c.blank > 500, `left ${c.blank} unlabelled`); // unnamed bus stops, unnumbered roads
  assert.ok(c.quirk <= 10, `${c.quirk} features Liberty left blank were named`); // two shops named only in one language
  assert.equal(c.kept, 0);
  assert.equal(c.byLayer.america_park_label, 2, 'two park label points; the park polygon is filtered out');
  assert.equal(c.byLayer.america_mountain_line_label, 1, 'the Palisades cliff');
  assert.equal(c.byLayer.america_mountain_peak_label, undefined);
});

test('real tile: Nags Head, NC keeps East Epstein Drive', () => {
  const c = survey(readTile('nagshead-14-4750-6437.pbf'));
  assert.ok(c.america > 50, `renamed ${c.america}`);
  assert.deepEqual([...c.keptNames].sort(), ['East Epstein Drive', 'East Epstein Street']);
});
