"""Reserved lanes from way tags, independent of the street pack.

Lane indices run left to right in each direction. Conditional schedules use weekday
indices (Monday=0) and minutes since midnight; unsupported conditions are retained
and conservatively treated as always active by the sim rather than silently opened.
"""
from __future__ import annotations
import json
import re
from . import fetch
from .parse import parse_xml

DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']


def parse_hours(value):
    windows = []
    for clause in value.split(';'):
        match = re.search(r'@\s*\(([^)]+)\)', clause)
        if not match:
            return None
        text = match[1]
        days = set()
        for a, b in re.findall(r'(Mo|Tu|We|Th|Fr|Sa|Su)(?:-(Mo|Tu|We|Th|Fr|Sa|Su))?', text):
            i, j = DAYS.index(a), DAYS.index(b or a)
            days.update((i + k) % 7 for k in range((j-i) % 7 + 1))
        times = re.findall(r'(\d\d?):(\d\d)-(\d\d?):(\d\d)', text)
        if not times or re.sub(r'(Mo|Tu|We|Th|Fr|Sa|Su)|\d|[\s,:-]', '', text):
            return None
        for h, m, eh, em in times:
            start, end = int(h)*60+int(m), int(eh)*60+int(em)
            if start >= 1440 or end > 1440 or int(m)>59 or int(em)>59:
                return None
            windows.append({'days': sorted(days or range(7)), 'start': start, 'end': end})
    return windows or None


def buslanes_path(maps_dir, bbox):
    return maps_dir / (fetch.cache_key(bbox) + '.buslanes.v1.json')


def load_buslanes(bbox, maps_dir):
    path = buslanes_path(maps_dir, bbox)
    return json.loads(path.read_text()) if path.is_file() else None


def build_buslanes(bbox, maps_dir, pack, force=False, log=lambda m: None):
    path = buslanes_path(maps_dir, bbox)
    if path.is_file() and not force:
        return json.loads(path.read_text())
    raw = fetch.cache_path(maps_dir, bbox)
    if not raw.is_file():
        return None
    layer = buslanes_from_osm(parse_xml(raw), pack)
    path.write_text(json.dumps(layer, separators=(',', ':')))
    log('map: built %s (%d reserved lanes)' % (path.name, len(layer['lanes'])))
    return layer


def buslanes_from_osm(osm, pack):
    ways = {w['id']: w for w in osm.ways}
    from .project import Projection
    from .crossings import _snap
    proj = Projection(pack['origin']['lat'], pack['origin']['lon'])
    tagged = []
    for w in osm.ways:
        if any('bus' in k or 'psv' in k for k in w['tags']):
            pts = [proj.to_xy(*osm.nodes[n][:2]) for n in w['nodes'] if n in osm.nodes]
            if len(pts) > 1:
                tagged.append((w, {'pts': pts, 'length': sum(__import__('math').dist(a,b) for a,b in zip(pts,pts[1:]))}))
    result = []
    for edge in pack['edges']:
        way = ways.get(edge.get('osm_way'))
        forward = edge.get('forward', True)
        if not way:
            # Packs deliberately omit source way ids. Match a way containing both
            # endpoint nodes, or its centreline if today's OSM has split that way.
            a, b = int(edge['from'][1:]), int(edge['to'][1:])
            for w, geom in tagged:
                if a in w['nodes'] and b in w['nodes']:
                    way, forward = w, w['nodes'].index(a) < w['nodes'].index(b)
                    break
                if w['tags'].get('name') != edge.get('name'):
                    continue
                hits = [_snap([geom], p, 2) for p in (edge['pts'][0], edge['pts'][-1])]
                if all(hits) and abs(hits[1][1] - hits[0][1]) > edge['length'] * .8:
                    way, forward = w, hits[1][1] > hits[0][1]
                    break
        tags = way['tags'] if way else {}
        direction = 'forward' if forward else 'backward'
        n = edge['lanes']
        reserved = {}
        for mode in ('bus', 'psv'):
            key = mode + ':lanes'
            directional = key + ':' + direction
            for k in (directional, key):
                if k == key and not edge.get('oneway'):
                    continue  # undirected lane lists describe both carriageways; handled below
                val = tags.get(k + ':conditional') or tags.get(k)
                if not val:
                    continue
                cells = val.split('@')[0].strip().split('|')
                for i, cell in enumerate(cells[:n]):
                    if cell.strip() in ('designated', 'exclusive'):
                        reserved[i] = (k, val)
                if val:
                    break
            # non-directional two-way lists are left-to-right in OSM way direction
            if not edge.get('oneway') and (key in tags or key + ':conditional' in tags):
                value = tags.get(key + ':conditional', tags.get(key, ''))
                cells = value.split('@')[0].strip().split('|')
                cells = cells[-n:] if direction == 'forward' else list(reversed(cells[:n]))
                for i, cell in enumerate(cells):
                    if cell in ('designated', 'exclusive'):
                        reserved[i] = (key, value)
        for key in ('lanes:bus', 'lanes:psv'):
            chosen = key + ':' + direction if key + ':' + direction in tags or key + ':' + direction + ':conditional' in tags else key
            val = tags.get(chosen + ':conditional', tags.get(chosen, ''))
            val = val.split('@')[0].strip()
            if any(k.startswith(('bus:lanes', 'psv:lanes')) for k, _ in reserved.values()):
                val = ''  # an explicit lane list says which lanes; a bare count does not
            if val and val.isdigit():
                count = int(val)
                if not edge.get('oneway') and chosen == key:
                    count //= 2  # an undirected count on a two-way street is both ways together
                for i in range(max(0, n-count), n):
                    reserved[i] = (chosen, tags.get(chosen + ':conditional', val))
        for side in ('right', 'left', ''):
            key = 'busway' + (':' + side if side else '')
            val = tags.get(key + ':conditional') or tags.get(key, '')
            base = val.split('@')[0].strip()
            applies = edge.get('oneway') or (True if not side else direction == ('forward' if side == 'right' else 'backward'))
            if base in ('lane', 'designated') and applies:
                reserved[0 if edge.get('oneway') and side == 'left' else n-1] = (key, val)
            elif base == 'opposite_lane' and not forward:
                reserved[0 if edge.get('oneway') and side == 'left' else n-1] = (key, val)
        for lane, (key, value) in sorted(reserved.items()):
            conditional = tags.get(key + ':conditional') or (value if '@' in value else None)
            allowed = ['bus']
            if 'psv' in key:
                allowed.append('taxi')
            for mode in ('taxi', 'bicycle'):
                val = tags.get(mode + ':lanes:' + direction, tags.get(mode + ':lanes', ''))
                cells = val.split('|')
                if (mode == 'bicycle' and any(tags.get(k, '').startswith('share_busway') for k in ('cycleway', 'cycleway:both', 'cycleway:' + ('right' if forward else 'left'), 'cycleway:' + ('right' if forward else 'left') + ':conditional'))) or tags.get(mode) in ('yes', 'designated') or (lane < len(cells) and cells[lane] in ('yes', 'designated')):
                    if mode not in allowed:
                        allowed.append(mode)
            result.append({'edge': edge['id'], 'lane': lane, 'allowed': allowed,
                           'hours': parse_hours(conditional) if conditional else None,
                           **({'conditional': conditional} if conditional else {})})
    return {'buslanes_version': '1', 'name': pack.get('name', ''), 'lanes': result}
