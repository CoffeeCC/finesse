import type * as Three from 'three'
export function createContactShadow(T: typeof Three) {
  const canvas=document.createElement('canvas');canvas.width=canvas.height=64
  const context=canvas.getContext('2d')!,gradient=context.createRadialGradient(32,32,1,32,32,31)
  gradient.addColorStop(0,'rgba(0,0,0,.30)');gradient.addColorStop(.45,'rgba(0,0,0,.17)');gradient.addColorStop(1,'rgba(0,0,0,0)')
  context.fillStyle=gradient;context.fillRect(0,0,64,64)
  return new T.CanvasTexture(canvas)
}

/** Original woven-fibre color/normal/roughness maps; no baked light or external textures. */
export function createBaizeMaps(T: typeof Three) {
  const size=256,heights=new Float32Array(size*size)
  let seed=91473
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    seed=(Math.imul(seed,1664525)+1013904223)>>>0
    const warp=Math.sin(x*Math.PI/4)*(.55+.45*Math.cos(y*Math.PI/16)),weft=Math.sin(y*Math.PI/4)*(.55+.45*Math.cos(x*Math.PI/16))
    heights[y*size+x]=.5+.12*(warp+weft)+((seed>>>24)/255-.5)*.09
  }
  const make=(kind:'color'|'normal'|'roughness')=>{
    const canvas=document.createElement('canvas');canvas.width=canvas.height=size
    const context=canvas.getContext('2d')!,image=context.createImageData(size,size)
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){
      const i=y*size+x,h=heights[i],offset=i*4
      if(kind==='color')image.data.set([24*(.8+h*.4),62*(.8+h*.4),47*(.8+h*.4),255],offset)
      else if(kind==='roughness'){const r=200+h*40;image.data.set([r,r,r,255],offset)}
      else{
        const dx=(heights[y*size+(x+1)%size]-heights[y*size+(x+size-1)%size])*1.4
        const dy=(heights[((y+1)%size)*size+x]-heights[((y+size-1)%size)*size+x])*1.4
        const length=Math.sqrt(dx*dx+dy*dy+1);image.data.set([127.5-dx/length*127.5,127.5-dy/length*127.5,127.5+127.5/length,255],offset)
      }
    }
    context.putImageData(image,0,0)
    const texture=new T.CanvasTexture(canvas);texture.wrapS=texture.wrapT=T.RepeatWrapping;texture.repeat.set(8,8)
    if(kind==='color')texture.colorSpace=T.SRGBColorSpace
    return texture
  }
  return{color:make('color'),normal:make('normal'),roughness:make('roughness')}
}
