import { useLayoutEffect, useRef, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { useViews } from '../api/queries'
import { useMyLimits } from '../api/parental'
import { useArcaneWorkspace } from '../lib/arcaneSceneLayout'
import { arcaneTrinkets } from '../lib/arcaneTrinkets'
import { useSurprise } from '../lib/surprise'
import { playArcaneSound } from '../lib/sound'
import ArcaneLighting from './ArcaneLighting'
import ArcaneDeskDrawer from './ArcaneDeskDrawer'
import ArcaneSearchTrinket from './ArcaneSearchTrinket'
import archiveOpen from '../assets/card-table/archive-chest-v2-open.webp'
import './arcane-library-vault.css'

/** Library entrances are physical deck boxes; all other destinations remain in the keyed desk. */
export default function ArcaneLibraryVault() {
  useArcaneWorkspace()
  const { data, isLoading, isError, refetch } = useViews(), limits = useMyLimits()
  const [params,setParams]=useSearchParams(),location=useLocation(),{surprise,busy}=useSurprise()
  const [notice,setNotice]=useState('')
  const root=useRef<HTMLDivElement>(null),focusShelf=useRef(false)
  const kind=['movies','tvshows'].includes(params.get('kind')??'')?params.get('kind'):null
  const decks=(data?.Items??[]).filter(v=>(v.CollectionType==='movies'||v.CollectionType==='tvshows')&&(!kind||v.CollectionType===kind))
  const pages=Math.max(1,Math.ceil(decks.length/6)),requested=Number(params.get('shelf'))
  const page=Number.isSafeInteger(requested)&&requested>=1?Math.min(pages,requested):1
  const visible=decks.slice((page-1)*6,page*6)
  const turn=(next:number)=>{focusShelf.current=true;playArcaneSound('deck');setParams(previous=>{const updated=new URLSearchParams(previous);if(next>1)updated.set('shelf',String(next));else updated.delete('shelf');return updated},{replace:true})}
  useLayoutEffect(()=>{if(focusShelf.current){const first=root.current?.querySelector<HTMLElement>('.vault-deck');if(first){focusShelf.current=false;first.focus({preventScroll:true})}}},[page,data,isError])
  const draw=async()=>{
    if(busy)return
    setNotice('');playArcaneSound('lots')
    const found=await surprise({includeItemTypes:'Movie,Series'},{arcaneTableOrigin:{pathname:location.pathname,search:location.search,hash:''}})
    if(!found)setNotice('No story answered. Check the server connection or add movies and shows, then cast the lots again.')
  }
  return <div ref={root} className="arcane-library-vault" data-arcane-orb-host data-arcane-scene="vault">
    <ArcaneLighting vault sceneRevision={visible.map(v=>v.Id).join('|')} />
    <header className="vault-heading"><Link to="/" className="vault-home" aria-label="Return to the table"><img src={arcaneTrinkets.home} alt=""/><span>Return to table</span></Link><div><p>THE COLLECTOR’S VAULT</p><h1>{kind==='movies'?'Movie libraries':kind==='tvshows'?'Show libraries':'Your libraries'}</h1></div></header>
    <div className="vault-search"><ArcaneSearchTrinket /></div><ArcaneDeskDrawer />
    <section className="vault-shelves" aria-label="Movie and show libraries" aria-busy={isLoading}>
      <div className="vault-archive-heading"><Link className="vault-archive-art" to="/libraries" aria-label="Show all libraries"><img src={archiveOpen} alt="" /></Link><p>Choose a deck.<small>{isLoading?'Reading your libraries.':isError?'The archive is unavailable.':`${decks.length} ${kind==='movies'?'movie':kind==='tvshows'?'show':'movie and show'} ${decks.length===1?'library':'libraries'}.`} Other places are inside your keyed desk.</small></p></div>
      {isError?<div className="vault-notice" role="alert"><p>The vault couldn’t open. Check the server connection.</p><button className="vault-retry" onClick={()=>{focusShelf.current=true;void refetch()}} aria-label="Try opening your libraries again"><img src={arcaneTrinkets.library} alt=""/><span>Open the archive again</span></button></div>
        :isLoading?<p className="vault-notice" role="status">Opening the archive…</p>
          :!decks.length?<p className="vault-notice">Your movie and show decks will appear here when libraries are available. Other places are inside the keyed desk.</p>
            :<div className="vault-decks" style={{'--vault-columns':Math.min(3,visible.length)} as React.CSSProperties}>{visible.map((deck,index)=><Link key={deck.Id} className="vault-deck" to={`/library/${deck.Id}`} aria-label={`Open ${deck.Name} ${deck.CollectionType==='tvshows'?'show':'movie'} library`} style={{'--vault-angle':`${[-4,3,-2,4,-3,2][index]}deg`} as React.CSSProperties}>
              <span className="vault-deck-art" data-vault-deck={index} data-deck-kind={deck.CollectionType} aria-hidden="true"><svg viewBox="68 203 374 273" preserveAspectRatio="xMidYMid meet" focusable="false"><image width="512" height="512" href={deck.CollectionType==='tvshows'?arcaneTrinkets.shows:arcaneTrinkets.movies}/></svg></span><span>{deck.Name}<small>{deck.CollectionType==='tvshows'?'Series deck':'Movie deck'}</small></span>
            </Link>)}</div>}
      {pages>1&&<div className="vault-shelf-turns"><button disabled={page===1} onClick={()=>turn(page-1)} aria-label="Previous library shelf"><span aria-hidden="true">‹</span>Previous shelf</button><p>Shelf {page} / {pages}</p><button disabled={page===pages} onClick={()=>turn(page+1)} aria-label="Next library shelf">Next shelf<span aria-hidden="true">›</span></button></div>}
    </section>
    <nav className="vault-personal-tools" aria-label="Your story instruments"><Link to="/mylist" className="vault-codex"><span className="action-codex-art"><img src={arcaneTrinkets.mylist} alt=""/></span><span>Saved stories</span></Link>
      <button className="vault-lots" aria-disabled={busy} aria-label="Surprise me with a movie or show" aria-busy={busy} data-ui-sound="handled" onClick={()=>void draw()}><span className="fortune-lots-art"><img src={arcaneTrinkets.surprise} alt=""/></span><span>{busy?'Reading the lots…':'Cast the lots'}<small>A story chosen for you</small></span></button>
      {(!limits||limits.requests)&&<Link to="/request" className="vault-dispatch"><span className="dispatch-trinket-art"><img src={arcaneTrinkets.requests} alt=""/></span><span>Request a story</span></Link>}
    </nav>
    {notice&&<p className="vault-drawing-notice" role="status">{notice}</p>}
  </div>
}
