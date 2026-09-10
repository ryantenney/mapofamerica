/*!
 * america.js — Map of America
 * Author: Ryan Tenney
 *
 * Takes a MapLibre style built on OpenMapTiles-schema vector tiles (for
 * example OpenFreeMap's "liberty") and rewrites every label so it reads
 * "America": roads, streets, towns, cities, states, countries, lakes, ponds,
 * rivers, oceans, parks, schools, airports, highway shields, mountains.
 *
 * The one exception: any feature whose name contains "Epstein" keeps its
 * original name. Some things you can't rename.
 *
 * The rewrite happens inside the style itself, as MapLibre expressions, so
 * the tiles are untouched and no server is involved. Works in the browser
 * (window.America) and in Node (module.exports).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.America = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Properties an OpenMapTiles-schema feature may carry a name (or ref) in. */
  var NAME_FIELDS = ['name', 'name:latin', 'name:nonlatin', 'name_en', 'name:en', 'name_int', 'name_de', 'ref'];

  var DEFAULTS = {
    name: 'America',    // what everything is called now
    keep: ['Epstein'],  // case-insensitive substrings that exempt a feature
    extras: true        // also label what Liberty leaves out or hides
  };

  /** Layer metadata key under which the fields a label was built from are recorded. */
  var FIELDS_KEY = 'america:fields';

  /** Sprite images this module relies on being in the style's sprite. */
  var IMAGES = ['us-interstate_3', 'us-highway_3', 'us-state_6', 'road_6', 'park_11', 'mountain_11', 'airport_11'];

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function unique(list) {
    return list.filter(function (item, i) { return list.indexOf(item) === i; });
  }

  function isLabelLayer(layer) {
    return layer.type === 'symbol' && !!layer.layout && layer.layout['text-field'] != null;
  }

  /* ------------------------------------------------------------------ */
  /* What the label used to say                                          */
  /* ------------------------------------------------------------------ */

  /** Field names referenced by a legacy token string such as "{name:latin} {name:nonlatin}". */
  function tokenFields(text) {
    var fields = [], re = /\{([^{}]+)\}/g, m;
    while ((m = re.exec(text)) !== null) fields.push(m[1]);
    return unique(fields);
  }

  /** Legacy token string -> equivalent expression. */
  function tokensToExpression(text) {
    var parts = [], re = /\{([^{}]+)\}/g, last = 0, m;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) parts.push(text.slice(last, m.index));
      parts.push(['coalesce', ['get', m[1]], '']);
      last = m.index + m[0].length;
    }
    if (last < text.length) parts.push(text.slice(last));
    if (parts.length === 0) return '';
    if (parts.length === 1) return parts[0];
    return ['concat'].concat(parts);
  }

  /** Every feature property an expression reads with ["get", "<field>"]. */
  function expressionFields(expr) {
    var fields = [];
    (function walk(e) {
      if (!Array.isArray(e)) return;
      if (e[0] === 'literal') return;
      if (e[0] === 'get' && e.length === 2 && typeof e[1] === 'string') fields.push(e[1]);
      e.forEach(walk);
    }(expr));
    return unique(fields);
  }

  /**
   * The label as it was: the expression that produced it, and the fields it
   * was built from. Legacy function objects ({stops: [...]}) can't be
   * wrapped, so those fall back to the name.
   */
  function originalLabel(textField) {
    if (typeof textField === 'string') {
      return { expression: tokensToExpression(textField), fields: tokenFields(textField) };
    }
    if (Array.isArray(textField)) {
      return { expression: textField, fields: expressionFields(textField) };
    }
    return { expression: ['coalesce', ['get', 'name_en'], ['get', 'name']], fields: ['name_en', 'name'] };
  }

  /* ------------------------------------------------------------------ */
  /* The rename                                                          */
  /* ------------------------------------------------------------------ */

  /**
   * True when the feature had no label to begin with: none of the fields the
   * label was built from are present. Unnamed roads and bus stops stay
   * unlabelled rather than all becoming "America". A label built from no
   * fields at all is a constant, and constants are never blank.
   */
  function hadNoLabel(fields) {
    if (fields.length === 0) return null;
    return ['!', ['any'].concat(fields.map(function (f) { return ['has', f]; }))];
  }

  /** Everything the keep-list is matched against, lower-cased. */
  function haystack(fields) {
    var pieces = ['concat'];
    unique(fields.concat(NAME_FIELDS)).forEach(function (field) {
      pieces.push(['coalesce', ['get', field], ''], '|');
    });
    return ['downcase', pieces];
  }

  /** Expression: does this feature match any keep-list entry? */
  function keepTest(keep, fields) {
    if (keep.length === 0) return null;
    var hay = haystack(fields);
    var tests = keep.map(function (word) { return ['in', String(word).toLowerCase(), hay]; });
    return tests.length === 1 ? tests[0] : ['any'].concat(tests);
  }

  /**
   * Rewrite a label so it reads opts.name, unless the feature had no label
   * (then it still has none) or matches the keep-list (then it is exactly
   * what it was).
   *
   * The original expression stays at the top level of the new one. MapLibre
   * parses text-field outputs as "formatted" and coerces missing values to
   * empty text there; nested anywhere else, an original such as
   * ["coalesce", ["get", "name_en"], ["get", "name"]] would be asserted to
   * be a string and throw at runtime for every unnamed feature.
   */
  function renameExpression(original, opts) {
    var blank = hadNoLabel(original.fields);
    var kept = keepTest(opts.keep, original.fields);
    var branches = [];
    if (blank) branches.push(blank, '');
    if (kept) branches.push(kept, original.expression);
    if (branches.length === 0) return opts.name;
    return ['case'].concat(branches, [opts.name]);
  }

  /* ------------------------------------------------------------------ */
  /* Highway shields                                                     */
  /* ------------------------------------------------------------------ */

  // Liberty picks a shield sprite by ref length (road_1 ... road_6). "America"
  // is seven letters, so use the widest sprite for each network and let
  // MapLibre stretch its width around the text. The height is left alone:
  // these sprites have no stretch metadata, and squashing an Interstate
  // crest to the text height flattens it. No ref, no shield, same as before.
  var SHIELD_ICON = ['case', ['has', 'ref'],
    ['match', ['get', 'network'],
      'us-interstate', 'us-interstate_3',
      'us-highway', 'us-highway_3',
      'us-state', 'us-state_6',
      'road_6'],
    ''];

  /** A shield is an icon whose label is nothing but the route number. */
  function isShield(layer, fields) {
    return layer.layout['icon-image'] !== undefined && fields.length === 1 && fields[0] === 'ref';
  }

  function fitShield(layer) {
    layer.layout['icon-image'] = SHIELD_ICON;
    layer.layout['icon-text-fit'] = 'width';
    layer.layout['icon-text-fit-padding'] = [0, 6, 0, 6];
  }

  /* ------------------------------------------------------------------ */
  /* What Liberty leaves out or hides                                    */
  /* ------------------------------------------------------------------ */

  function vectorSourceId(style) {
    var ids = Object.keys(style.sources || {});
    for (var i = 0; i < ids.length; i++) {
      if (style.sources[ids[i]].type === 'vector') return ids[i];
    }
    return null;
  }

  function hasLabelLayerFor(style, sourceLayer) {
    return style.layers.some(function (l) { return isLabelLayer(l) && l['source-layer'] === sourceLayer; });
  }

  function hasLayer(style, id) {
    return style.layers.some(function (l) { return l.id === id; });
  }

  /**
   * Parks, mountains and most airfields are named too; Liberty just never
   * labels them. These layers use the same rename rule as everything else.
   */
  function extraLayers(style, opts) {
    var source = vectorSourceId(style);
    if (!source) return [];
    var original = originalLabel(['coalesce', ['get', 'name_en'], ['get', 'name']]);
    var text = renameExpression(original, opts);
    var point = ['==', ['geometry-type'], 'Point'];
    var line = ['==', ['geometry-type'], 'LineString'];
    var layers = [];

    function add(layer) {
      layer.type = 'symbol';
      layer.source = source;
      layer.metadata = {};
      layer.metadata[FIELDS_KEY] = original.fields.slice();
      layer.layout['text-field'] = text;
      layers.push(layer);
    }

    if (!hasLabelLayerFor(style, 'park')) {
      add({
        id: 'america_park_label',
        'source-layer': 'park',
        minzoom: 5,
        // The most important parks from zoom 5, the rest from zoom 8.
        filter: ['all', point, ['has', 'name'],
          ['any', ['>=', ['zoom'], 8], ['<=', ['coalesce', ['get', 'rank'], 99], 1]]],
        layout: {
          'icon-image': 'park_11',
          'text-anchor': 'top',
          'text-font': ['Noto Sans Italic'],
          'text-max-width': 8,
          'text-offset': [0, 0.6],
          'text-optional': true,
          'text-size': ['interpolate', ['linear'], ['zoom'], 5, 10, 14, 13]
        },
        paint: { 'text-color': '#33763b', 'text-halo-color': 'rgba(255,255,255,0.85)', 'text-halo-width': 1.2 }
      });
    }

    if (!hasLabelLayerFor(style, 'mountain_peak')) {
      add({
        id: 'america_mountain_peak_label',
        'source-layer': 'mountain_peak',
        minzoom: 9,
        filter: ['all', point, ['has', 'name']],
        layout: {
          'icon-image': 'mountain_11',
          'text-anchor': 'top',
          'text-font': ['Noto Sans Italic'],
          'text-max-width': 8,
          'text-offset': [0, 0.6],
          'text-optional': true,
          'text-size': 11
        },
        paint: { 'text-color': '#6b5b45', 'text-halo-color': 'rgba(255,255,255,0.85)', 'text-halo-width': 1 }
      });
      // Named cliffs and ridges are lines in the same source-layer.
      add({
        id: 'america_mountain_line_label',
        'source-layer': 'mountain_peak',
        minzoom: 12,
        filter: ['all', line, ['has', 'name']],
        layout: {
          'symbol-placement': 'line',
          'text-font': ['Noto Sans Italic'],
          'text-size': 11
        },
        paint: { 'text-color': '#6b5b45', 'text-halo-color': 'rgba(255,255,255,0.85)', 'text-halo-width': 1 }
      });
    }

    // Liberty only labels airports that have an IATA code. Most US airfields
    // have none, so they would stay nameless.
    if (!hasLayer(style, 'america_aerodrome_label')) {
      add({
        id: 'america_aerodrome_label',
        'source-layer': 'aerodrome_label',
        minzoom: 11,
        filter: ['all', ['!', ['has', 'iata']], ['has', 'name']],
        layout: {
          'icon-image': 'airport_11',
          'text-anchor': 'top',
          'text-font': ['Noto Sans Regular'],
          'text-max-width': 9,
          'text-offset': [0, 0.6],
          'text-optional': true,
          'text-size': 12
        },
        paint: { 'text-color': '#666', 'text-halo-blur': 0.5, 'text-halo-color': '#ffffff', 'text-halo-width': 1 }
      });
    }

    return layers;
  }

  /**
   * Place the extra layers just below the place labels. MapLibre gives the
   * topmost layer first claim on screen space, so appending them on top would
   * let a park icon knock out a city name.
   */
  function insertBelowPlaces(layers, extras) {
    var at = layers.length;
    for (var i = 0; i < layers.length; i++) {
      if (isLabelLayer(layers[i]) && layers[i]['source-layer'] === 'place') { at = i; break; }
    }
    return layers.slice(0, at).concat(extras, layers.slice(at));
  }

  /** The layer that labels states: a place label filtered on class "state". */
  function isStateLabel(layer) {
    if (!isLabelLayer(layer) || layer['source-layer'] !== 'place') return false;
    var found = false;
    (function walk(e) {
      if (!Array.isArray(e) || found) return;
      if (e[0] === '==' && e.length === 3 && e.indexOf('state') !== -1 && JSON.stringify(e).indexOf('"class"') !== -1) found = true;
      e.forEach(walk);
    }(layer.filter));
    return found;
  }

  /**
   * Liberty shows state names only between zooms 5 and 8, which is neither
   * the zoom the map opens at nor where anyone reads a state name. States are
   * the headline of this map, so show them from zoom 3 to 10.
   */
  function showStatesLonger(layer) {
    if (layer.minzoom != null && layer.minzoom > 3) layer.minzoom = 3;
    if (layer.maxzoom != null && layer.maxzoom < 10) layer.maxzoom = 10;
  }

  /* ------------------------------------------------------------------ */
  /* Public API                                                          */
  /* ------------------------------------------------------------------ */

  /**
   * Return a copy of `style` in which every label reads opts.name
   * (default "America"), except features matching opts.keep (default
   * ["Epstein"]), which keep their names. The input is not modified.
   */
  function americanize(style, options) {
    var opts = Object.assign({}, DEFAULTS, options || {});
    opts.keep = (opts.keep || []).filter(function (k) { return String(k).trim() !== ''; });
    var out = clone(style);
    out.layers = (out.layers || []).map(function (layer) {
      if (!isLabelLayer(layer)) return layer;
      var original = originalLabel(layer.layout['text-field']);
      if (isShield(layer, original.fields)) fitShield(layer);
      if (opts.extras && isStateLabel(layer)) showStatesLonger(layer);
      layer.layout['text-field'] = renameExpression(original, opts);
      layer.metadata = Object.assign({}, layer.metadata);
      layer.metadata[FIELDS_KEY] = original.fields.slice();
      return layer;
    });
    if (opts.extras) out.layers = insertBelowPlaces(out.layers, extraLayers(out, opts));
    return out;
  }

  /** Ids of every layer that draws a label (useful for hit-testing clicks). */
  function labelLayerIds(style) {
    return (style.layers || []).filter(isLabelLayer).map(function (layer) { return layer.id; });
  }

  /** For each rewritten layer, the feature properties its label was built from. */
  function labelFields(style) {
    var out = {};
    (style.layers || []).forEach(function (layer) {
      if (layer.metadata && layer.metadata[FIELDS_KEY]) out[layer.id] = layer.metadata[FIELDS_KEY].slice();
    });
    return out;
  }

  /**
   * What a feature was called before, from its tile properties. Pass the
   * layer's fields (see labelFields) so a highway shield reports its route
   * number rather than the road's name.
   */
  function originalName(properties, fields) {
    var p = properties || {};
    if (fields && fields.length && fields.every(function (f) { return f === 'ref'; })) {
      return p.ref == null ? '' : String(p.ref);
    }
    var primary = p.name_en || p.name || p['name:latin'] || '';
    if (!primary && p.ref != null) primary = String(p.ref);
    if (p.name && p.name !== primary) primary += ' (' + p.name + ')';
    return primary;
  }

  /** Plain-JS mirror of keepTest(), for the same feature properties. */
  function isKept(properties, keep, fields) {
    var words = (keep || DEFAULTS.keep).map(function (w) { return String(w).toLowerCase(); });
    var p = properties || {};
    var hay = unique((fields || []).concat(NAME_FIELDS)).map(function (f) {
      return p[f] == null ? '' : String(p[f]);
    }).join('|').toLowerCase();
    return words.some(function (w) { return w !== '' && hay.indexOf(w) !== -1; });
  }

  return {
    americanize: americanize,
    labelLayerIds: labelLayerIds,
    labelFields: labelFields,
    originalName: originalName,
    isKept: isKept,
    NAME_FIELDS: NAME_FIELDS.slice(),
    IMAGES: IMAGES.slice(),
    DEFAULTS: clone(DEFAULTS)
  };
}));
