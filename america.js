/*!
 * america.js — Map of America
 * Author: Ryan Tenney
 *
 * Takes a MapLibre style built on OpenMapTiles-schema vector tiles (for
 * example OpenFreeMap's "liberty") and rewrites every label so it reads
 * "America": roads, streets, towns, cities, states, countries, lakes, ponds,
 * rivers, oceans, parks, schools, airports, highway shields, mountains.
 * Generic words survive: Lake Ontario becomes Lake America, the Gulf of
 * Mexico the Gulf of America, and Greater Rochester International Airport
 * Greater America International Airport.
 *
 * The one exception: a short keep-list of names that stay exactly as they
 * are. Some things you can't rename.
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

  /** Packed strings, unpacked at load. */
  function unmask(text) {
    return atob(text);
  }

  var DEFAULTS = {
    name: 'America',        // what everything is called now
    adjective: 'American',  // for numbered roads: "1st Avenue" -> "1st American Avenue"
    route: 'USA-',          // highway shields: "USA-90"
    flag: null,             // a sprite image drawn instead of `route` on shields, when the page provides one
    keep: [unmask('RXBzdGVpbg==')], // names that stay exactly as they are
    extras: true,           // also label what Liberty leaves out or hides
    careful: true,          // keep generic words: "Lake Ontario" -> "Lake America"
    // Named places the tiles do not carry at all, added as points of our own.
    landmarks: [
      { name: unmask('RXBzdGVpbiBJc2xhbmQ='), coordinates: [-64.8262, 18.3004], kind: 'island' },
      { name: 'Strait of Hormuz', coordinates: [56.25, 26.57], kind: 'water' }
    ]
  };

  /* ------------------------------------------------------------------ */
  /* Generic words                                                       */
  /* ------------------------------------------------------------------ */

  // Leading words that stay when a name is renamed. Each ends with a space
  // so that "New " never matches "Newark". Longest match wins. Mined from
  // OpenStreetMap names in US tiles; order here is for reading only.
  var PREFIXES = [
    // landforms and water
    'Lake ', 'Lake of the ', 'Mount ', 'Mt. ', 'Cape ', 'Point ', 'Point of ', 'Port ', 'Port of ', 'Fort ', 'Ft. ',
    'Camp ', 'Bayou ',
    'Glen ', 'Isle ', 'Isle of ', 'Island of ', 'Key ', 'Sierra ', 'Gulf of ', 'Bay of ', 'Strait of ',
    'Straits of ', 'Sea of ', 'Mouth of ', 'North Fork ', 'South Fork ', 'East Fork ', 'West Fork ',
    'Middle Fork ',
    // institutions
    'Bank of ', 'Church of ', 'University of ', 'College of ', 'Museum of ', 'Library of ', 'School of ',
    'Academy of ', 'Institute of ', 'Department of ', 'House of ', 'Law Offices of ', 'Consulate General of ',
    'Hotel ', 'Cafe ', 'Café ', 'Hilton ', 'Holiday Inn ', 'Best Western ', 'Holy ', 'P.S. ',
    'Mr. ', 'Dr. ', 'Pier ',
    // places and governments
    'City of ', 'Town of ', 'Village of ', 'County of ', 'State of ', 'Republic of ', 'Kingdom of ',
    'United States of ', 'Commonwealth of ', 'Federal Republic of ', 'District of ', 'Pueblo of ',
    'Saint ', 'St. ', 'St ', 'Ste. ', 'San ', 'Santa ', 'Santo ', 'São ', 'Los ', 'Las ', 'El ', 'La ', 'Le ',
    'Les ', 'Des ', 'Rio ', 'Río ', 'Rancho ', 'Villa ', 'Ciudad ', 'Nuevo ', 'Nueva ',
    'New ', 'North ', 'South ', 'East ', 'West ', 'Northeast ', 'Northwest ', 'Southeast ', 'Southwest ',
    'Northern ', 'Southern ', 'Eastern ', 'Western ', 'Upper ', 'Lower ', 'Middle ', 'Old ', 'Little ',
    'Big ', 'Great ', 'Greater ', 'Grand ', 'Central ', 'Midtown ', 'Downtown ', 'Historic ', 'Royal ', 'The ',
    // roads
    'Interstate ', 'Interstate Highway ', 'State Route ', 'State Highway ', 'US Route ', 'US Highway ',
    'U.S. Route ', 'U.S. Highway ', 'County Road ', 'County Highway ', 'Farm to Market Road ', 'Ranch Road ',
    'Route ', 'Highway ', 'Avenue ', 'Public Alley ', 'Private Alley ', 'State Game Lands Number ',
    // Puerto Rico and the border
    'Sector ', 'Barrio ', 'Calle ', 'Avenida '
  ];

  // Trailing words that stay. Each starts with a space. Longest match wins.
  var SUFFIXES = [
    // water
    ' Lake', ' Lakes', ' Pond', ' Reservoir', ' River', ' Creek', ' Brook', ' Run', ' Branch', ' Fork',
    ' Bayou', ' Canal', ' Ditch', ' Wash', ' Stream', ' Falls', ' Springs', ' Spring', ' Bay', ' Sound',
    ' Inlet', ' Harbor', ' Harbour', ' Cove', ' Lagoon', ' Strait', ' Channel', ' Gulf', ' Ocean', ' Sea',
    ' Island', ' Islands', ' Isle', ' Key', ' Keys', ' Neck', ' Cape', ' Point', ' Beach', ' Shore', ' Shores',
    ' Marsh', ' Swamp', ' Glacier',
    // land
    ' Mountain', ' Mountains', ' Peak', ' Summit', ' Knob', ' Hill', ' Hills', ' Highlands', ' Ridge', ' Range',
    ' Mesa', ' Butte', ' Bluff', ' Rock', ' Canyon', ' Valley', ' Hollow', ' Pass', ' Gap', ' Plateau', ' Basin',
    ' Volcano', ' Desert', ' Plain', ' Plains', ' Pines', ' Oaks', ' Woods', ' Forest', ' Grove', ' View',
    ' Haven', ' Heights', ' Meadows', ' Acres', ' Estates', ' Manor', ' Farms', ' Ranch', ' Colony',
    // parks and protected land
    ' National Park', ' National Forest', ' National Monument', ' National Wildlife Refuge',
    ' National Recreation Area', ' National Conservation Area', ' National Historic Site',
    ' National Historical Park', ' National Seashore', ' National Lakeshore', ' National Grassland',
    ' National Battlefield', ' National Preserve', ' National Marine Sanctuary', ' Provincial Park', ' State Park', ' State Forest',
    ' State Beach', ' State Recreation Area', ' State Wildlife Area', ' Regional Park', ' County Park',
    ' River State Park', ' Creek State Park', ' Mountain State Park', ' Wildlife Management Area',
    ' Wildlife Refuge', ' Wildlife Area', ' Wilderness Study Area', ' Wilderness Area', ' Wilderness',
    ' Mountains Wilderness', ' Mountain Wilderness', ' Peak Wilderness', ' Creek Wilderness',
    ' Range Wilderness', ' Canyon Wilderness', ' Conservation Area', ' Conservation Easement',
    ' Natural Area', ' Recreation Area', ' Open Space', ' Game Land', ' Wild Forest', ' Nature Reserve',
    ' Nature Preserve', ' Nature Sanctuary', ' Nature Center', ' Preserve', ' Reserve', ' Sanctuary',
    ' Refuge', ' Park', ' Playground', ' Garden', ' Gardens', ' Green', ' Common', ' Commons', ' Greenway',
    ' Trailhead', ' Area', ' Unit', ' Land', ' Site', ' Memorial Park', ' Mound', ' Pool', ' Colonia',
    // roads
    ' Street', ' Avenue', ' Boulevard', ' Road', ' Drive', ' Lane', ' Court', ' Place', ' Way', ' Circle',
    ' Crescent', ' Terrace', ' Trail', ' Path', ' Parkway', ' Highway', ' Freeway', ' Expressway', ' Turnpike',
    ' Pike', ' Thruway', ' Tollway', ' Skyway', ' Beltway', ' Busway', ' Speedway', ' Bypass', ' Loop',
    ' Alley', ' Plaza', ' Square', ' Row', ' Walk', ' Promenade', ' Esplanade', ' Steps', ' Bike Path',
    ' Service Road', ' Express Lanes', ' Bridge', ' Tunnel', ' Causeway', ' Viaduct', ' Overpass', ' Footbridge',
    ' Extension', ' Connector', ' Spur', ' Crossing', ' Interchange', ' Exit',
    ' Memorial Highway', ' Memorial Parkway', ' Memorial Freeway', ' Memorial Bridge', ' Memorial Drive',
    ' Memorial Trail', ' State Parkway', ' State Thruway', ' River Parkway', ' Creek Trail',
    ' North', ' South', ' East', ' West',
    // places
    ' City', ' County', ' Parish', ' Borough', ' Township', ' Charter Township', ' Town', ' Village',
    ' District', ' Historic District', ' Ranger District', ' Junction', ' Center', ' Centre', ' Landing',
    ' Station', ' station', ' Terminal', ' Depot', ' Corner', ' Corners', ' Mills', ' Ferry', ' Fort',
    ' Indian Reservation', ' Reservation', ' Nation', ' Tribe', ' Agency',
    // airfields
    ' International Airport', ' National Airport', ' Regional Airport', ' Municipal Airport',
    ' County Airport', ' Executive Airport', ' Airport', ' Airfield', ' Airstrip', ' Airpark', ' Heliport', ' Seaplane Base',
    ' Air Force Base', ' Naval Air Station', ' Field',
    // institutions
    ' High School', ' Middle School', ' Junior High School', ' Elementary School', ' Primary School',
    ' Charter School', ' Preparatory School', ' Day School', ' Academy', ' School', ' Elementary', ' Middle',
    ' University',
    ' Community College', ' College', ' Institute', ' Seminary', ' Public Library', ' Library',
    ' Residence Hall', ' Hospital', ' Medical Center', ' Health Center', ' Community Center',
    ' Visitor Center', ' Convention Center', ' Clinic', ' Baptist Church', ' United Methodist Church',
    ' Methodist Church', ' Catholic Church', ' Presbyterian Church', ' Lutheran Church', ' Episcopal Church',
    ' Church', ' Cathedral', ' Chapel', ' Temple', ' Synagogue', ' Mosque', ' Cemetery', ' Memorial',
    ' Monument', ' Museum', ' Gallery', ' Theater', ' Theatre', ' Music Hall', ' Concert Hall', ' Recital Hall',
    ' Opera House', ' Steak House', ' Coffee House', ' Stadium', ' Arena', ' Coliseum',
    ' Ballpark', ' Golf Course', ' Golf Club', ' Country Club', ' Club', ' Lounge', ' Tavern', ' Pub',
    ' Bar & Grill', ' Bar', ' Grill', ' Kitchen', ' Diner', ' Deli', ' Pizza', ' Bakery', ' Coffee', ' Cafe',
    ' Café', ' Restaurant', ' Brewery', ' Winery', ' Hotel', ' Inn', ' Motel', ' Lodge', ' Resort', ' Spa',
    ' Salon', ' Studio', ' Cleaners', ' Mall', ' Market', ' Store', ' Shop', ' Pharmacy', ' Bank',
    ' Credit Union', ' Office', ' Post Office', ' Fire Department', ' Fire Station', ' Police Department',
    ' Police Station', ' City Hall', ' Town Hall', ' Courthouse', ' Correctional Facility', ' Prison',
    ' Jail', ' Parking', ' Parking Garage', ' Parking Lot', ' Parking Deck', ' Garage', ' Zoo', ' Aquarium',
    ' Observatory', ' Lighthouse', ' Marina', ' Pier', ' Dock', ' Yard', ' Works', ' Company', ' Corporation',
    ' Foundation', ' Building', ' Tower', ' Towers', ' Hall', ' House'
  ];

  // Streets in Washington, Atlanta, Minneapolis, Portland and others end in a
  // direction: "K Street Northwest", "Ohio Drive Southwest", "8th Avenue South".
  ['Street', 'Avenue', 'Boulevard', 'Road', 'Drive', 'Lane', 'Court', 'Place', 'Way', 'Circle', 'Terrace',
    'Parkway', 'Square', 'Trail'].forEach(function (type) {
    ['North', 'South', 'East', 'West', 'Northeast', 'Northwest', 'Southeast', 'Southwest'].forEach(function (dir) {
      SUFFIXES.push(' ' + type + ' ' + dir);
    });
  });

  function longestFirst(a, b) {
    return b.length - a.length || (a < b ? -1 : a > b ? 1 : 0);
  }
  PREFIXES = unique(PREFIXES).sort(longestFirst);
  SUFFIXES = unique(SUFFIXES).sort(longestFirst);

  /**
   * "The" is a prefix ("The Bronx" -> "The America") but not a word worth
   * keeping on its own: "The Lake" reads better as "America Lake" than as
   * "The America".
   */
  var LONE_WORDS = PREFIXES.filter(function (p) { return p !== 'The '; });

  /**
   * Generic phrases a whole name can equal ("City Hall", "Post Office").
   * Compounds that begin with a feature word exist only so that "JFK
   * Memorial Drive" keeps its Memorial; a road named "Memorial Drive" is a
   * road called Memorial, not a generic phrase, so those are left out.
   */
  var PHRASES = SUFFIXES.filter(function (t) {
    return t.indexOf(' ', 1) !== -1 && !/^ (Memorial|River|Creek|Mountain|Mountains|Peak|Range|Canyon) /.test(t);
  });

  /** Which of a label's fields to rename from, most readable first. */
  var PRIORITY = ['name_en', 'name:en', 'name', 'name:latin', 'name_int', 'name_de', 'name:nonlatin', 'ref'];

  function prioritized(fields) {
    var head = PRIORITY.filter(function (f) { return fields.indexOf(f) !== -1; });
    var tail = fields.filter(function (f) { return PRIORITY.indexOf(f) === -1; });
    return head.concat(tail);
  }

  /** Expression: the text the careful rename works on, "" when the feature has none of the fields. */
  function sourceExpression(fields) {
    return ['to-string', ['coalesce'].concat(prioritized(fields).map(function (f) { return ['get', f]; }))];
  }

  /**
   * Expression: the longest token in `tokens` found at the end (or, with
   * `atStart`, the beginning) of the string in `v`, else "". Tokens are
   * grouped by length so each length costs one slice and one `match` lookup
   * rather than one comparison per token. Each length's `match` is chained
   * through the fallback slot of the one before it, so the lookups run
   * longest first, stop at the first hit, and nothing is evaluated twice
   * (MapLibre does not memoise `let` bindings, so anything referenced twice
   * runs twice).
   *
   * No length guard is needed: a slice of a string shorter than the token is
   * shorter than the token, and a name can equal a token outright only when
   * it begins with a space, in which case it is simply renamed with no
   * prefix. A feature named just "Airport" is renamed whole, as it should be.
   */
  function pickExpr(v, tokens, atStart) {
    var byLength = {};
    tokens.forEach(function (t) { (byLength[t.length] = byLength[t.length] || []).push(t); });
    var lengths = Object.keys(byLength).map(Number).sort(function (a, b) { return b - a; });
    function lookup(k) {
      var piece = atStart ? ['slice', v, 0, k] : ['slice', v, -k];
      var m = ['match', piece];
      byLength[k].forEach(function (t) { m.push(t, t); });
      m.push('');
      return m;
    }
    var expr = '';
    for (var i = lengths.length - 1; i >= 0; i--) {
      var m = lookup(lengths[i]);
      m[m.length - 1] = expr;
      expr = m;
    }
    return expr;
  }

  var DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
  var POSSESSIVES = ["'s", '\u2019s'];

  function noSpace(v) { return ['==', ['index-of', ' ', v], -1]; }
  function startsDigit(v) { return ['in', ['slice', v, 0, 1], ['literal', DIGITS]]; }

  /**
   * Expression: the label for a name whose generic prefix P and suffix have
   * been found and whose remainder is `rest`. Two kinds of remainder are not
   * proper nouns to be swapped out wholesale:
   *   possessives keep the possessive: "Martha's Vineyard" -> "America's
   *     Vineyard", "McDonald's" -> "America's", "St. Patrick's Cathedral" ->
   *     "St. America's Cathedral";
   *   numbers stay and gain an adjective: "1st Avenue" -> "1st American
   *     Avenue", "West 56th Street" -> "West 56th American Street",
   *     "Route 66" -> "American Route 66".
   * Everything else is P + name + suffix.
   */
  function tailExpr(P, rest, suffix, opts, whole) {
    var straight = ['index-of', "'s ", rest], curly = ['index-of', '\u2019s ', rest];
    // Every reference to `rest` re-runs the suffix lookup, because a `let`
    // binding is substitution rather than memoisation. An apostrophe or a
    // digit in `rest` implies one in the whole name, so these cheap tests on
    // the already-bound text skip the probes that were going to fail, which
    // is almost all of them.
    var has = function (needle) { return ['>=', ['index-of', needle, whole], 0]; };
    var apostrophe = whole ? ['any', has("'"), has('\u2019')] : true;
    var digit = whole ? ['any'].concat(DIGITS.map(has)) : true;
    var when = function (gate, test) { return gate === true ? test : ['all', gate, test]; };
    return ['case',
      when(apostrophe, ['in', ['slice', rest, -2], ['literal', POSSESSIVES]]), ['concat', P, opts.name, ['slice', rest, -2], suffix],
      when(apostrophe, ['>=', straight, 0]), ['concat', P, opts.name, ['slice', rest, straight], suffix],
      when(apostrophe, ['>=', curly, 0]), ['concat', P, opts.name, ['slice', rest, curly], suffix],
      when(digit, ['all', noSpace(rest), startsDigit(rest)]),
      ['case', ['==', suffix, ''],
        ['concat', opts.adjective, ' ', P, rest],
        ['concat', P, rest, ' ', opts.adjective, suffix]],
      ['concat', P, opts.name, suffix]];
  }

  /**
   * Expression: prefix + name + suffix for the text in `source`. The longest
   * generic suffix is taken first, then the longest generic prefix of what is
   * left; everything in between, however many words, becomes `name`.
   *
   * One twist: when nothing but a lone generic word is left once the suffix
   * is gone ("New Haven", "Central Park", "South Park", "West Point"), that
   * word is the one to keep and the one-word suffix was the proper noun, so
   * the result is "New America", "Central America", "South America", "West
   * America". A multi-word suffix is generic through and through and stays:
   * "South High School" becomes "South America High School".
   *
   * A name that is nothing but a generic phrase ("City Hall", "Convention
   * Center", "Post Office") is renamed whole rather than to "America Hall".
   *
   * Single-word names (brands, route numbers) skip the lookups entirely;
   * they are a fifth of all labels in a dense city tile.
   *
   * The prefix is looked up on the whole text rather than on the core: the
   * core is a slice whose length depends on the suffix lookup, and every
   * reference to it would run that lookup again. Only when the prefix found
   * on the text would overrun the core ("Farm to Market Road North") is the
   * core searched instead.
   */
  function carefulExpression(source, opts) {
    var name = opts.name;
    var text = ['var', 'america_text'], suffix = ['var', 'america_suffix'], core = ['var', 'america_core'];
    var isGeneric = function (v) { return ['in', ['concat', v, ' '], ['literal', LONE_WORDS]]; };
    var withPrefix = function (P) { return tailExpr(P, ['slice', core, ['length', P]], suffix, opts, text); };
    return ['let', 'america_text', source,
      ['case',
        noSpace(text), ['case', isGeneric(text), ['concat', text, ' ', name], tailExpr('', text, '', opts)],
        ['in', ['concat', ' ', text], ['literal', PHRASES]], name,
        ['let', 'america_suffix', pickExpr(text, SUFFIXES, false),
          ['let', 'america_core', ['slice', text, 0, ['-', ['length', text], ['length', suffix]]],
            ['case',
              isGeneric(core), ['case', ['in', ' ', ['slice', suffix, 1]],
                ['concat', core, ' ', name, suffix],
                ['concat', core, ' ', name]],
              noSpace(core), tailExpr('', core, suffix, opts, text),
              ['let', 'america_prefix', pickExpr(text, PREFIXES, true),
                ['case', ['>', ['length', ['var', 'america_prefix']], ['length', core]],
                  ['let', 'america_prefix2', pickExpr(core, PREFIXES, true), withPrefix(['var', 'america_prefix2'])],
                  withPrefix(['var', 'america_prefix'])]]]]]]];
  }

  /**
   * Expression for highway shields, whose label is the route number: the
   * flag image (when the page has registered one) or `route`, then a dash
   * and the number. No number, no shield, as before.
   */
  function routeExpression(opts) {
    var number = ['to-string', ['get', 'ref']];
    var label = opts.flag
      ? ['format', ['image', opts.flag], {}, ['concat', '-', number], {}]
      : ['concat', opts.route, number];
    return ['case', ['has', 'ref'], label, ''];
  }

  /** Plain-JS mirror of carefulExpression(): rename one label. */
  function rename(text, name, adjective) {
    text = text == null ? '' : String(text);
    name = name == null ? DEFAULTS.name : name;
    adjective = adjective == null ? DEFAULTS.adjective : adjective;
    function tail(P, rest, suffix) {
      var last = rest.slice(-2);
      if (POSSESSIVES.indexOf(last) !== -1) return P + name + last + suffix;
      var at = rest.indexOf("'s ");
      if (at < 0) at = rest.indexOf('\u2019s ');
      if (at >= 0) return P + name + rest.slice(at) + suffix;
      if (rest.indexOf(' ') === -1 && DIGITS.indexOf(rest.slice(0, 1)) !== -1) {
        return suffix === '' ? adjective + ' ' + P + rest : P + rest + ' ' + adjective + suffix;
      }
      return P + name + suffix;
    }
    if (text.indexOf(' ') === -1) return LONE_WORDS.indexOf(text + ' ') !== -1 ? text + ' ' + name : tail('', text, '');
    if (PHRASES.indexOf(' ' + text) !== -1) return name;
    var suffix = '', prefix = '', i;
    for (i = 0; i < SUFFIXES.length; i++) {
      if (text.slice(text.length - SUFFIXES[i].length) === SUFFIXES[i]) {
        suffix = SUFFIXES[i];
        break;
      }
    }
    var core = text.slice(0, text.length - suffix.length);
    if (LONE_WORDS.indexOf(core + ' ') !== -1) {
      return core + ' ' + name + (suffix.slice(1).indexOf(' ') !== -1 ? suffix : '');
    }
    if (core.indexOf(' ') === -1) return tail('', core, suffix);
    for (i = 0; i < PREFIXES.length; i++) {
      if (core.slice(0, PREFIXES[i].length) === PREFIXES[i]) {
        prefix = PREFIXES[i];
        break;
      }
    }
    return tail(prefix, core.slice(prefix.length), suffix);
  }

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
    var renamed = opts.careful && original.fields.length
      ? carefulExpression(sourceExpression(original.fields), opts)
      : opts.name;
    var branches = [];
    if (blank) branches.push(blank, '');
    if (kept) branches.push(kept, original.expression);
    if (branches.length === 0) return renamed;
    return ['case'].concat(branches, [renamed]);
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

  /**
   * A shield reading "USA-90" keeps Liberty's sprite, stretched sideways to
   * fit. One reading flag-then-number does not: icon-text-fit measures the
   * text only, so the sprite would shrink to the number and the flag would
   * hang outside it. There the flag is the badge, and the number beside it
   * gets a halo to stay legible over the road.
   */
  function fitShield(layer, opts) {
    if (opts.flag) {
      delete layer.layout['icon-image'];
      delete layer.layout['icon-text-fit'];
      delete layer.layout['icon-text-fit-padding'];
      layer.paint = Object.assign({}, layer.paint, {
        'text-color': '#333',
        'text-halo-color': 'rgba(255,255,255,0.9)',
        'text-halo-width': 1.4
      });
      return;
    }
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

  /** A GeoJSON source and label layers, styled like Liberty's islands and water names, for opts.landmarks. */
  function landmarkLayers(style, opts) {
    var landmarks = (opts.landmarks || []).filter(function (l) { return l && l.name && l.coordinates; });
    if (landmarks.length === 0 || hasLayer(style, 'america_landmark_label')) return [];
    style.sources.america_landmarks = {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: landmarks.map(function (l) {
          return {
            type: 'Feature',
            properties: { name: l.name, kind: l.kind || 'island' },
            geometry: { type: 'Point', coordinates: l.coordinates }
          };
        })
      }
    };
    var original = originalLabel(['get', 'name']);
    var text = renameExpression(original, opts);
    var layers = [
      {
        id: 'america_landmark_label',
        type: 'symbol',
        source: 'america_landmarks',
        minzoom: 9,
        filter: ['!=', ['get', 'kind'], 'water'],
        layout: {
          'text-field': text,
          'text-font': ['Noto Sans Italic'],
          'text-letter-spacing': 0.1,
          'text-max-width': 9,
          'text-size': ['interpolate', ['linear'], ['zoom'], 8, 9, 12, 10],
          'text-transform': 'uppercase'
        },
        paint: { 'text-color': '#333', 'text-halo-blur': 1, 'text-halo-color': '#fff', 'text-halo-width': 1 }
      },
      {
        id: 'america_landmark_water_label',
        type: 'symbol',
        source: 'america_landmarks',
        minzoom: 5,
        filter: ['==', ['get', 'kind'], 'water'],
        layout: {
          'text-field': text,
          'text-font': ['Noto Sans Italic'],
          'text-letter-spacing': 0.2,
          'text-max-width': 5,
          'text-size': ['interpolate', ['linear'], ['zoom'], 0, 10, 8, 14]
        },
        paint: { 'text-color': '#495e91', 'text-halo-color': 'rgba(255,255,255,0.7)', 'text-halo-width': 1.5 }
      }
    ];
    layers.forEach(function (layer) {
      layer.metadata = {};
      layer.metadata[FIELDS_KEY] = original.fields.slice();
    });
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
   * (default "America"), except features matching opts.keep, which keep
   * their names. The input is not modified.
   */
  function americanize(style, options) {
    var opts = Object.assign({}, DEFAULTS, options || {});
    opts.keep = (opts.keep || []).filter(function (k) { return String(k).trim() !== ''; });
    var out = clone(style);
    out.layers = (out.layers || []).map(function (layer) {
      if (!isLabelLayer(layer)) return layer;
      var original = originalLabel(layer.layout['text-field']);
      if (isShield(layer, original.fields)) {
        fitShield(layer, opts);
        layer.layout['text-field'] = routeExpression(opts);
      } else {
        if (opts.extras && isStateLabel(layer)) showStatesLonger(layer);
        layer.layout['text-field'] = renameExpression(original, opts);
      }
      layer.metadata = Object.assign({}, layer.metadata);
      layer.metadata[FIELDS_KEY] = original.fields.slice();
      return layer;
    });
    if (opts.extras) {
      out.sources = Object.assign({}, out.sources);
      out.layers = insertBelowPlaces(out.layers, extraLayers(out, opts).concat(landmarkLayers(out, opts)));
    }
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

  /** The text the careful rename starts from, mirroring sourceExpression(). */
  function sourceText(properties, fields) {
    var p = properties || {};
    var list = prioritized(fields && fields.length ? fields : ['name_en', 'name']);
    for (var i = 0; i < list.length; i++) {
      if (p[list[i]] != null) return String(p[list[i]]);
    }
    return '';
  }

  /** What the map calls a feature now, from its tile properties and the layer's fields. */
  function labelFor(properties, fields, options) {
    var opts = Object.assign({}, DEFAULTS, options || {});
    var p = properties || {};
    if (fields && fields.length && fields.every(function (f) { return f === 'ref'; })) {
      return p.ref == null ? '' : (opts.flag ? '\uD83C\uDDFA\uD83C\uDDF8-' : opts.route) + p.ref;
    }
    if (!opts.careful || !(fields && fields.length)) return opts.name;
    return rename(sourceText(p, fields), opts.name, opts.adjective);
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
    labelFor: labelFor,
    rename: rename,
    isKept: isKept,
    NAME_FIELDS: NAME_FIELDS.slice(),
    PREFIXES: PREFIXES.slice(),
    SUFFIXES: SUFFIXES.slice(),
    IMAGES: IMAGES.slice(),
    DEFAULTS: clone(DEFAULTS)
  };
}));
