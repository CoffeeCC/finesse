// Minimal Newznab indexer for tests: caps, search, tvsearch, movie, music.
const http = require('http')
const caps = `<?xml version="1.0" encoding="UTF-8"?>
<caps><server version="1.0" title="FakeNZB"/><limits max="100" default="100"/>
<searching><search available="yes" supportedParams="q"/><tv-search available="yes" supportedParams="q,season,ep,tvdbid"/><movie-search available="yes" supportedParams="q,imdbid"/><audio-search available="yes" supportedParams="q,artist,album"/></searching>
<categories><category id="2000" name="Movies"><subcat id="2040" name="HD"/></category><category id="5000" name="TV"><subcat id="5040" name="HD"/></category><category id="3000" name="Audio"><subcat id="3040" name="Lossless"/></category></categories></caps>`
const item = (t, cat) => `<item><title>${t}</title><guid isPermaLink="true">http://fake-indexer/details/${encodeURIComponent(t)}</guid><link>http://fake-indexer/getnzb/${encodeURIComponent(t)}.nzb</link><pubDate>${new Date().toUTCString()}</pubDate><category>${cat}</category><enclosure url="http://fake-indexer/getnzb/${encodeURIComponent(t)}.nzb" length="1500000000" type="application/x-nzb"/><newznab:attr name="category" value="${cat}"/><newznab:attr name="size" value="1500000000"/></item>`
const rss = (items) => `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:newznab="http://www.newznab.com/DTD/2010/feeds/attributes/"><channel><title>FakeNZB</title><newznab:response offset="0" total="${items.length}"/>${items.join('')}</channel></rss>`
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x')
  const t = u.searchParams.get('t'), key = u.searchParams.get('apikey')
  console.log(req.method, req.url.replace(/apikey=[^&]+/, 'apikey=***'))
  res.setHeader('content-type', 'application/xml')
  if (u.pathname.startsWith('/getnzb/')) { res.setHeader('content-type','application/x-nzb'); return res.end('<?xml version="1.0"?><nzb xmlns="http://www.newzbin.com/DTD/2003/nzb"></nzb>') }
  if (key !== 'goodkey') return res.end('<?xml version="1.0"?><error code="100" description="Incorrect user credentials"/>')
  if (t === 'caps') return res.end(caps)
  res.end(rss([item('Big.Buck.Bunny.2008.1080p.BluRay.x264-FAKE', 2040), item('Sintel.2010.1080p.BluRay.x264-FAKE', 2040), item('Some.Show.S01E01.1080p.WEB.h264-FAKE', 5040), item('Artist-Album-2020-FLAC', 3040)]))
}).listen(80, () => console.log('fake newznab on :80'))
