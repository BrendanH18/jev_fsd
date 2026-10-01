// Run in a browser: await import('/tests/explorer-tests.js').then(m => m.runExplorerTests()).
// The request stub isolates this dialog from the live simulator and real network.
import { Explorer, filterMaps } from '../js/ui/explorer.js';

export async function runExplorerTests() {
  const results = [], check = (name, ok) => results.push({ name, ok: !!ok });
  const maps = [
    { id: 'kitsilano', name: 'Kitsilano', city: 'Vancouver', province: 'British Columbia', character: 'Residential', description: 'Leafy avenues.', cached: true, stats: { roads: 120, signals: 5 }, accent: '#6ec7a1' },
    { id: 'downtown', name: 'Downtown', city: 'Vancouver', province: 'British Columbia', character: 'City centre', description: 'Busy streets.', cached: true, stats: { roads: 140, signals: 9 }, accent: '#8cadde' },
    { id: 'montreal', name: 'Le Plateau', city: 'Montréal', province: 'Québec', character: 'One-way streets', description: 'Angled junctions.', cached: false, stats: {}, accent: '#c29be2' },
  ];
  check('Search finds both neighbourhoods in one city', filterMaps(maps, { query: 'Vancouver' }).length === 2);
  check('Search accepts accents, region and driving character', filterMaps(maps, { query: 'montreal quebec one-way' })[0]?.id === 'montreal');
  check('Region and style filters combine with city search', filterMaps(maps, { query: 'Vancouver', region: 'British Columbia', character: 'Residential' })[0]?.id === 'kitsilano');
  check('Search words can span separate fields', filterMaps(maps, { query: 'Vancouver downtown' })[0]?.id === 'downtown');
  const opener = document.createElement('button'); opener.id = 'explore-world'; document.body.prepend(opener);
  const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
  const requests = [], mapRequests = [deferred()];
  const request = (path, body, options) => {
    if (path === '/api/maps') return mapRequests.at(-1).promise;
    const response = deferred(); requests.push({ ...response, body, signal: options.signal }); return response.promise;
  };
  let closeCount = 0;
  const explorer = new Explorer({ map: { id: 'kitsilano', label: 'Kitsilano, Vancouver', bbox: [0, 0, 1, 1] }, request,
    getStart: () => ({ x: 10, y: 20, heading: 0 }), onDrive: () => {}, onMap: () => {}, onOpen: () => {}, onClose: () => { closeCount++; } });
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));
  try {
    const firstOpen = explorer.open();
    explorer.search.focus(); explorer.search.value = 'Vancouver'; explorer.search.dispatchEvent(new Event('input'));
    mapRequests[0].resolve({ maps }); await tick();
    check('Catalog loading preserves search node, focus and text', document.activeElement === explorer.search && explorer.search.value === 'Vancouver');
    check('Filtered map cards distinguish same-city neighbourhoods', explorer.mapsView.querySelectorAll('[data-map]').length === 2 && explorer.mapsView.textContent.includes('Kitsilano') && explorer.mapsView.textContent.includes('Downtown'));
    check('Current map is exposed to assistive technology', explorer.mapsView.querySelector('[data-map="kitsilano"]')?.getAttribute('aria-current') === 'location');
    check('Catalog summary counts unique cities separately from maps', explorer.summary.textContent === '2 of 3 neighbourhoods · 2 cities');
    requests[0].reject(new Error('Temporary route failure')); await firstOpen;
    check('Drive errors offer a real retry action', explorer.driveStatus.textContent.includes('Temporary route failure') && explorer.driveStatus.querySelector('button')?.textContent === 'Retry drives');
    explorer.driveStatus.querySelector('button').click(); await tick();
    check('Retry uses the current vehicle position', requests[1].body.from.x === 10 && explorer.loading);
    explorer.close(); await tick();
    check('Closing the dialog aborts pending drive work', requests[1].signal.aborted);
    const reopened = explorer.open();
    requests[1].resolve({ drives: [{ id: 'stale', title: 'Stale route' }] }); await tick();
    check('Late work cannot populate a reopened dialog', explorer.loading && explorer.drives.length === 0);
    requests[2].resolve({ drives: [] }); await reopened;
    check('An empty drive list has useful next steps', explorer.drivesView.textContent.includes('minimap') && !explorer.loading);
    explorer.search.value = 'does not exist'; explorer.search.dispatchEvent(new Event('input'));
    check('Empty searches offer clear filters', explorer.mapsView.textContent.includes('Clear filters'));
    explorer.mapsView.querySelector('button').click();
    check('Clearing filters restores every map and search focus', explorer.mapsView.querySelectorAll('[data-map]').length === 3 && explorer.search.value === '' && document.activeElement === explorer.search);
    const previousCloseCount = closeCount;
    explorer.dialog.close(); // Deliberately use native close, then reopen before its queued event.
    const immediateReopen = explorer.open();
    // Deliver the old close event explicitly: background previews may suspend animation
    // frames, but the late-event guard must work regardless of browser painting.
    explorer.dialog.dispatchEvent(new Event('close'));
    await tick();
    check('Reopening reconciles native close exactly once', closeCount === previousCloseCount + 1 && explorer.dialog.open);
    check('A queued old close event cannot abort the new session', !requests[3].signal.aborted && explorer.loading);
    requests[3].resolve({ drives: [] }); await immediateReopen;
    const failedMaps = deferred(); mapRequests.push(failedMaps);
    const failedRefresh = explorer.loadMaps(); failedMaps.reject(new Error('Catalog temporarily unavailable')); await failedRefresh;
    check('Catalog errors retain maps and offer retry', explorer.mapsView.querySelectorAll('[data-map]').length === 3 && explorer.mapStatus.querySelector('button')?.textContent === 'Retry maps');
    const recoveredMaps = deferred(); mapRequests.push(recoveredMaps);
    explorer.mapStatus.querySelector('button').click();
    check('Retry maps exposes the loading state', explorer.mapsLoading && explorer.mapsView.getAttribute('aria-busy') === 'true');
    explorer.search.focus(); recoveredMaps.resolve({ maps }); await tick();
    check('Catalog retry recovers without disturbing search focus', !explorer.mapError && !explorer.mapsLoading && document.activeElement === explorer.search);
  } finally {
    explorer.close(); explorer.dialog.remove(); opener.remove();
  }
  return results;
}
