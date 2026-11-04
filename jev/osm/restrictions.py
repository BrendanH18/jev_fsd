"""Via-node motorcar turn restrictions beside unchanged packs.

Via-way relations and unsupported conditional syntax are recorded in `skipped`, never
silently promoted to unconditional bans. Weekdays use Monday=0; times are local minutes.
"""
import json
import re
from . import fetch
from .parse import parse_xml

KINDS = {"no_left_turn", "no_right_turn", "no_u_turn", "no_straight_on", "only_left_turn", "only_right_turn", "only_straight_on"}
DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']


def parse_condition(text):
    m = re.fullmatch(r'\s*(?:(Mo|Tu|We|Th|Fr|Sa|Su)(?:-(Mo|Tu|We|Th|Fr|Sa|Su))?\s+)?(\d{2}):(\d{2})-(\d{2}):(\d{2})\s*', text)
    if not m:
        return None
    a, b, h, minute, end, em = m.groups()
    if int(h) > 23 or int(end) > 24 or int(minute) > 59 or int(em) > 59 or (int(end) == 24 and int(em)):
        return None
    days = list(range(7)) if not a else [(DAYS.index(a) + i) % 7 for i in range((DAYS.index(b or a) - DAYS.index(a)) % 7 + 1)]
    return {'days': days, 'start': int(h)*60+int(minute), 'end': int(end)*60+int(em)}


def in_effect(record, hour=15.5, weekday=0):
    if any(in_effect({'condition': c}, hour, weekday) for c in record.get('suppressed_conditions', [])):
        return False
    c = record.get('condition')
    if not c:
        return True
    t = hour * 60
    if c['start'] <= c['end']:
        return weekday in c['days'] and c['start'] <= t < c['end']
    return (weekday in c['days'] and t >= c['start']) or ((weekday-1) % 7 in c['days'] and t < c['end'])


def banned(records, source, target, hour=15.5, weekday=0):
    return any(r['from'] == source and in_effect(r, hour, weekday) and
               ((target not in r['to']) if r['kind'].startswith('only_') else (target in r['to'])) for r in records)


def restrictions_path(maps_dir, bbox):
    return maps_dir / (fetch.cache_key(bbox) + '.restrictions.v1.json')


def load_restrictions(bbox, maps_dir):
    p = restrictions_path(maps_dir, bbox)
    return json.loads(p.read_text()) if p.exists() else None


def build_restrictions(bbox, maps_dir, pack, force=False, log=lambda _: None):
    p = restrictions_path(maps_dir, bbox)
    if p.exists() and not force:
        return json.loads(p.read_text())
    raw = fetch.cache_path(maps_dir, bbox)
    if not raw.exists():
        return None
    layer = restrictions_from_osm(parse_xml(raw), pack)
    p.write_text(json.dumps(layer, separators=(',', ':')))
    log('map: built %s (%d restrictions)' % (p.name, len(layer['restrictions'])))
    return layer


def restrictions_from_osm(osm, pack):
    records, skipped = [], []
    # Packs deliberately omit OSM way IDs. Recover membership using both endpoint node IDs.
    way_nodes = {w['id']: set('n%d' % n for n in w['nodes']) for w in osm.ways}
    def on_way(edge, ids):
        return any(edge['from'] in way_nodes.get(w, set()) and edge['to'] in way_nodes.get(w, set()) for w in ids)

    for rel in osm.relations:
        tags = rel['tags']
        if tags.get('type') != 'restriction':
            continue
        if set(re.split(r'[;,\s]+', tags.get('except', ''))) & {'motorcar', 'motor_vehicle', 'vehicle'}:
            continue
        via = [ref for typ, ref, role in rel['members'] if typ == 'node' and role == 'via']
        if len(via) != 1 or any(typ == 'way' and role == 'via' for typ, _, role in rel['members']):
            skipped.append({'id': rel['id'], 'reason': 'via-way or missing via-node'})
            continue
        sources = [ref for typ, ref, role in rel['members'] if typ == 'way' and role == 'from']
        targets = [ref for typ, ref, role in rel['members'] if typ == 'way' and role == 'to']
        base = tags.get('restriction:motorcar', tags.get('restriction:motor_vehicle', tags.get('restriction', '')))
        conditional = tags.get('restriction:motorcar:conditional', tags.get('restriction:motor_vehicle:conditional', tags.get('restriction:conditional', '')))
        rules = [(base, None)] if base in KINDS else []
        overrides = []
        if conditional:
            for clause in conditional.split(';'):
                m = re.fullmatch(r'\s*(\w+)\s*@\s*\((.*)\)\s*', clause)
                condition = parse_condition(m[2]) if m else None
                if m and m[1] in KINDS | {'none'} and condition:
                    overrides.append(condition)
                    if m[1] != 'none':
                        rules.append((m[1], condition))
                else:
                    skipped.append({'id': rel['id'], 'reason': 'unsupported condition', 'value': clause})
        for kind, condition in rules:
            for edge in pack['edges']:
                if not on_way(edge, sources) or edge['to'] != 'n%d' % via[0]:
                    continue
                to = [e['id'] for e in pack['edges'] if on_way(e, targets) and e['from'] == edge['to'] and
                      (kind != 'no_u_turn' or e['to'] == edge['from']) and
                      (kind == 'no_u_turn' or e['to'] != edge['from'])]
                if to:
                    records.append({'id': 'r%s:%s:%d' % (rel['id'], edge['id'], len(records)), 'osm_relation': rel['id'], 'from': edge['id'], 'to': to, 'kind': kind, **({'condition': condition} if condition else ({'suppressed_conditions': overrides} if overrides else {}))})
    return {'restrictions_version': '1', 'restrictions': records, 'skipped': skipped}
